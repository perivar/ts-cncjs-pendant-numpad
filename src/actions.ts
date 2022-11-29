#!/usr/bin/env node

// actions
// A module that creates actions based on input from the numpad and
// sends them to a socket server (typically CNCjs) to execute them.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.

import log from 'npmlog';

import { Connector } from './connector';
import { Options } from './console';
import { GcodeGrbl } from './gcode-grbl';
import { GcodeMarlin } from './gcode-marlin';
import { GcodeSender } from './gcode-sender';
import { KeyboardEvent, NumpadController } from './numpad_controller';

//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'ACTIONS  '; // keep at 9 digits for consistency

// We don't have true continuous motor control, so we will simulate it with
// a timer and sending motion comments at specific intervals. Long intervals
// can be dangerous at high speeds as well as have an unresponsive feel, and
// intervals that are too short might result in unsmooth motion.
const JOG_INTERVAL = 100; // ms/interval; there are 60,000 ms/min.
const VXY_LOW = (250 * JOG_INTERVAL) / 60000; // mm/minute in terms of mm/interval, slow velocity.
const VXY_MED = (2000 * JOG_INTERVAL) / 60000; // mm/minute in terms of mm/interval, medium velocity.
const CXY_LOW = 0.5; // single impulse distance, slow.
const CXY_MED = 1.0; // single impluse distance, medium.
const VZ_LOW = (250 * JOG_INTERVAL) / 60000; // mm/minute in terms of mm/interval, z-axis,
const VZ_MED = (500 * JOG_INTERVAL) / 60000; // mm/minute in terms of mm/interval, z-axis,
const CZ_LOW = 0.1; // single impulse distance, z-axis.
const CZ_MED = 1.0; // single impulse distance, z-axis.

const CREEP_INTERVAL = 250; // delay before continuous movement.

//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
export const DEFAULT_MOVE_DISTANCE = 1;
interface NumpadState {
  moveDistance: number;
  previousKeyCode?: number;
}

//----------------------------------------------------------------------------
// Interface definitions.
//----------------------------------------------------------------------------
// A simple record that indicates the next jogging motion destination.
export class XYZCoords {
  move_x_axis = 0.0;
  move_y_axis = 0.0;
  move_z_axis = 0.0;
}

// An interface for holding actions mappings. Perhaps a bit overly broad.
export interface ActionsMappings {
  [key: string]: any;
}

// https://gist.github.com/Crenshinibon/5238119
// https://git.sr.ht/~sircmpwn/hare-sdl2/tree/7855e717d6af1b4f1e9ed15b7db9bda6686da954/item/sdl2/keyboard.ha
enum KEY_CODES {
  KEYCODE_UNKNOWN = 0,

  RETURN = 40,
  ESCAPE = 41,
  BACKSPACE = 42,
  TAB = 43,
  SPACE = 44,

  NUMLOCKCLEAR = 83, // num lock on PC, clear on Mac keyboards
  KP_DIVIDE = 84,
  KP_MULTIPLY = 85,
  KP_MINUS = 86,
  KP_PLUS = 87,
  KP_ENTER = 88,
  KP_1 = 89,
  KP_2 = 90,
  KP_3 = 91,
  KP_4 = 92,
  KP_5 = 93,
  KP_6 = 94,
  KP_7 = 95,
  KP_8 = 96,
  KP_9 = 97,
  KP_0 = 98,
  KP_PERIOD = 99,
}

//------------------------------------------------------------------------------
// Main module - provided access to command line options.
//------------------------------------------------------------------------------
export class Actions {
  connector: Connector; // connection to CNCjs
  numpadController: NumpadController; // connection to numpad
  options: Options; // program-wide options
  gcodeSender: GcodeSender; // abstraction interface
  jogTimer: NodeJS.Timer; // jog timer reference

  numpadState: NumpadState; // state of current numpad
  axisInstructions = new XYZCoords(); // next jog movement instructions

  //----------------------------------------------------------------------------
  // constructor()
  //----------------------------------------------------------------------------
  constructor(connector: Connector, options: Options) {
    this.connector = connector;
    this.numpadController = connector.numpadController;
    this.options = options;
    this.gcodeSender = this.newGcodeSender();
    this.numpadState = {
      moveDistance: DEFAULT_MOVE_DISTANCE, // Alter by F1, F2, F3
    };

    // listen for use events
    this.numpadController.on('use', this.onUse.bind(this));

    // schedule the jogFunction to run each JOG_INTERVAL (restarted in jogFunction)
    this.jogTimer = setTimeout(this.jogFunction.bind(this), JOG_INTERVAL);
  }

  //----------------------------------------------------------------------------
  // createGcodeSender()
  // Create an instance of the appropriate Gcode sender.
  //----------------------------------------------------------------------------
  newGcodeSender(): GcodeSender {
    let gcode: typeof GcodeSender;
    switch (this.options.controllerType.toLowerCase()) {
      case 'grbl':
        gcode = GcodeGrbl;
        break;
      case 'marlin':
        gcode = GcodeMarlin;
        break;
      default:
        log.error(
          LOGPREFIX,
          `Controller type ${this.options.controllerType} unknown; unable to continue`
        );
        process.exit(1);
    }
    return new gcode(this);
  }

  //--------------------------------------------------------------------------
  // Our heavy lifter. Every time a new event occurs, look at the totality of
  // the buttons in order to determine what to do. It's not a good idea to
  // respond to individual events that might get out of sync, especially
  // when button combinations are needed.
  //--------------------------------------------------------------------------
  onUse(kbdevent: KeyboardEvent) {
    const ai = new XYZCoords(); // mm to move each axis.

    // Get move distance modifier
    let distance = this.numpadState.moveDistance;

    const keyCode = kbdevent.key;
    const keyHex = kbdevent.key.toString(16);

    // ignore key code 0
    // if (keyCode === KEY_CODES.KEYCODE_UNKNOWN) {
    //   log.trace(
    //     LOGPREFIX,
    //     `Ignoring received keyCode: 0x${keyHex} = ${keyCode}`
    //   );
    //   return;
    // }

    log.info(
      LOGPREFIX,
      `Receiveed keyCode: 0x${keyHex} = ${keyCode}, current move distance: ${distance}`
    );

    const SMOOTH = true;
    const SLOW = false;
    if (SMOOTH) {
      //------------------------------------------------------------
      // Determine appropriate jog and creep values for the axes
      // X and Y, determined by the deadman key that's being used.
      // This isn't enabling motion yet, just selecting a speed in
      // case we select motion later.
      //------------------------------------------------------------

      const jogVelocity = SLOW ? VXY_LOW : VXY_MED;
      const creepDist = SLOW ? CXY_LOW : CXY_MED;

      //------------------------------------------------------------
      // Determine appropriate jog and creep values for the Z axis.
      // This is determined by which hat button is used. This isn't
      // enabling motion yet, just selecting a speed in case we
      // select motion later, so it doesn't matter if the key we're
      // testing is doing something else this round.
      //------------------------------------------------------------

      const jogVelocityZ = SLOW ? VZ_LOW : VZ_MED;
      const creepDistZ = SLOW ? CZ_LOW : CZ_MED;

      // ensure we are only moving the default distance
      distance = DEFAULT_MOVE_DISTANCE;

      let isJustPressed = false;
      if (
        this.numpadState.previousKeyCode !== undefined &&
        keyCode !== this.numpadState.previousKeyCode
      ) {
        // new key pressed
        isJustPressed = true;
      }

      switch (keyCode) {
        case KEY_CODES.KP_MINUS: // -                  (z axis up +Z)
          ai.move_z_axis = +distance * jogVelocityZ;
          if (isJustPressed) {
            clearTimeout(this.jogTimer);
            const d = creepDistZ * +distance;
            this.jogGantry(0, 0, d);
            this.jogTimer = setTimeout(
              this.jogFunction.bind(this),
              CREEP_INTERVAL
            );
          }
          break;
        case KEY_CODES.KP_PLUS: // +                   (z axis down -Z)
          ai.move_z_axis = -distance * jogVelocityZ;
          if (isJustPressed) {
            clearTimeout(this.jogTimer);
            const d = creepDistZ * -distance;
            this.jogGantry(0, 0, d);
            this.jogTimer = setTimeout(
              this.jogFunction.bind(this),
              CREEP_INTERVAL
            );
          }
          break;
        case KEY_CODES.KP_4: // arrow: left (4)        (move -X)
          ai.move_x_axis = -distance * jogVelocity;
          if (isJustPressed) {
            clearTimeout(this.jogTimer);
            const d = creepDist * -distance;
            this.jogGantry(d, 0, 0);
            this.jogTimer = setTimeout(
              this.jogFunction.bind(this),
              CREEP_INTERVAL
            );
          }
          break;
        case KEY_CODES.KP_6: // arrow: right (6)       (move +X)
          ai.move_x_axis = +distance * jogVelocity;
          if (isJustPressed) {
            clearTimeout(this.jogTimer);
            const d = creepDist * +distance;
            this.jogGantry(d, 0, 0);
            this.jogTimer = setTimeout(
              this.jogFunction.bind(this),
              CREEP_INTERVAL
            );
          }
          break;
        case KEY_CODES.KP_8: // arrow: up (8)          (move +Y)
          ai.move_y_axis = +distance * jogVelocity;
          if (isJustPressed) {
            clearTimeout(this.jogTimer);
            const d = creepDist * +distance;
            this.jogGantry(0, d, 0);
            this.jogTimer = setTimeout(
              this.jogFunction.bind(this),
              CREEP_INTERVAL
            );
          }
          break;
        case KEY_CODES.KP_2: // arrow: down (2)        (move -Y)
          ai.move_y_axis = -distance * jogVelocity;
          if (isJustPressed) {
            clearTimeout(this.jogTimer);
            const d = creepDist * -distance;
            this.jogGantry(0, d, 0);
            this.jogTimer = setTimeout(
              this.jogFunction.bind(this),
              CREEP_INTERVAL
            );
          }
          break;
        case KEY_CODES.KP_1: // arrow: End (1)         (move -X and -Y)
          ai.move_x_axis = -distance * jogVelocity;
          ai.move_y_axis = -distance * jogVelocity;
          break;
        case KEY_CODES.KP_9: // arrow: Page up (9)     (move +X and +Y)
          ai.move_x_axis = +distance * jogVelocity;
          ai.move_y_axis = +distance * jogVelocity;
          break;
        case KEY_CODES.KP_3: // arrow: Page Down (3)   (move +X and -Y)
          ai.move_x_axis = +distance * jogVelocity;
          ai.move_y_axis = -distance * jogVelocity;
          break;
        case KEY_CODES.KP_7: // Key 7: Home (7)        (move -X and +Y)
          ai.move_x_axis = -distance * jogVelocity;
          ai.move_y_axis = +distance * jogVelocity;
          break;
        case KEY_CODES.KP_5: // Key: 5                 (move to work home)
          this.gcodeSender.moveGantryWCSHomeXY();
          break;
        case KEY_CODES.TAB: // Key: Tab                (set work position to zero)
          this.gcodeSender.recordGantryZeroWCSX();
          this.gcodeSender.recordGantryZeroWCSY();
          this.gcodeSender.recordGantryZeroWCSZ();
          break;
        case KEY_CODES.KP_0: // Key: 0                 (unlock)
          this.gcodeSender.controllerUnlock();
          break;
        case KEY_CODES.KP_PERIOD: // Key: Period/Comma (probe)
          this.gcodeSender.performZProbingTwice();
          break;
        case KEY_CODES.KP_ENTER: // Key: Enter         (homing)
          this.gcodeSender.performHoming();
          break;
        case KEY_CODES.NUMLOCKCLEAR: // Numlock        (set work position for x and y to zero)
          this.gcodeSender.recordGantryZeroWCSX();
          this.gcodeSender.recordGantryZeroWCSY();
          break;
        case KEY_CODES.KP_DIVIDE: // key: /            (set move distance to 0.1)
          this.numpadState.moveDistance = 0.1;
          break;
        case KEY_CODES.KP_MULTIPLY: // key: *          (set move distance to 1)
          this.numpadState.moveDistance = 1;
          break;
        case KEY_CODES.BACKSPACE: // key: Backspace    (set move distance to 10)
          this.numpadState.moveDistance = 10;
          break;
        default:
          break;
      }

      // store current key in state
      if (keyCode !== KEY_CODES.KEYCODE_UNKNOWN)
        this.numpadState.previousKeyCode = keyCode;

      //==================================================
      // The timer function will pick these up and act
      // accordingly.
      //==================================================

      this.axisInstructions = ai;
    } else {
      switch (keyCode) {
        case KEY_CODES.KP_MINUS: // -                  (z axis up)
          this.gcodeSender.moveGantryRelative(0, 0, +distance);
          break;
        case KEY_CODES.KP_PLUS: // +                   (z axis down)
          this.gcodeSender.moveGantryRelative(0, 0, -distance);
          break;
        case KEY_CODES.KP_4: // arrow: left (4)        (move -X)
          this.gcodeSender.moveGantryRelative(-distance, 0, 0);
          break;
        case KEY_CODES.KP_6: // arrow: right (6)       (move +X)
          this.gcodeSender.moveGantryRelative(+distance, 0, 0);
          break;
        case KEY_CODES.KP_8: // arrow: up (8)          (move +Y)
          this.gcodeSender.moveGantryRelative(0, +distance, 0);
          break;
        case KEY_CODES.KP_2: // arrow: down (2)        (move -Y)
          this.gcodeSender.moveGantryRelative(0, -distance, 0);
          break;
        case KEY_CODES.KP_1: // arrow: End (1)         (move -X and -Y)
          this.gcodeSender.moveGantryRelative(-distance, -distance, 0);
          break;
        case KEY_CODES.KP_9: // arrow: Page up (9)     (move +X and +Y)
          this.gcodeSender.moveGantryRelative(+distance, +distance, 0);
          break;
        case KEY_CODES.KP_3: // arrow: Page Down (3)   (move +X and -Y)
          this.gcodeSender.moveGantryRelative(+distance, -distance, 0);
          break;
        case KEY_CODES.KP_7: // Key 7: Home (7)        (move -X and +Y)
          this.gcodeSender.moveGantryRelative(-distance, +distance, 0);
          break;
        case KEY_CODES.KP_5: // Key: 5                 (move to work home)
          this.gcodeSender.moveGantryWCSHomeXY();
          break;
        case KEY_CODES.TAB: // Key: Tab                (set work position to zero)
          this.gcodeSender.recordGantryZeroWCSX();
          this.gcodeSender.recordGantryZeroWCSY();
          this.gcodeSender.recordGantryZeroWCSZ();
          break;
        case KEY_CODES.KP_0: // Key: 0                 (unlock)
          this.gcodeSender.controllerUnlock();
          break;
        case KEY_CODES.KP_PERIOD: // Key: Period/Comma (probe)
          this.gcodeSender.performZProbingTwice();
          break;
        case KEY_CODES.KP_ENTER: // Key: Enter         (homing)
          this.gcodeSender.performHoming();
          break;
        case KEY_CODES.NUMLOCKCLEAR: // Numlock        (set work position for x and y to zero)
          this.gcodeSender.recordGantryZeroWCSX();
          this.gcodeSender.recordGantryZeroWCSY();
          break;
        case KEY_CODES.KP_DIVIDE: // key: /            (set move distance to 0.1)
          this.numpadState.moveDistance = 0.1;
          break;
        case KEY_CODES.KP_MULTIPLY: // key: *          (set move distance to 1)
          this.numpadState.moveDistance = 1;
          break;
        case KEY_CODES.BACKSPACE: // key: Backspace    (set move distance to 10)
          this.numpadState.moveDistance = 10;
          break;
        default:
          break;
      }

      // store current key in state
      if (keyCode !== KEY_CODES.KEYCODE_UNKNOWN)
        this.numpadState.previousKeyCode = keyCode;
    }
  }

  //--------------------------------------------------------------------------
  // We don't have continuous control over motors, so the best that we can
  // do is move them a certain distance for fixed periods of time. We will
  // simulate constant movement by sending new move commands at a fixed
  // frequency, when enabled.
  //--------------------------------------------------------------------------
  jogFunction() {
    // const state = this.numpadState;
    const ai = this.axisInstructions as XYZCoords;

    log.trace(
      LOGPREFIX,
      'jogFunction',
      `Heartbeat, serialConnected: ${this.connector.serialConnected}`
    );
    this.jogTimer = setTimeout(this.jogFunction.bind(this), JOG_INTERVAL);

    // if (Object.keys(state).length === 0 || Object.keys(ai).length === 0) return;
    if (Object.keys(ai).length === 0) return;
    if (ai.move_x_axis === 0 && ai.move_y_axis === 0 && ai.move_z_axis == 0)
      return;

    this.jogGantry(ai.move_x_axis, ai.move_y_axis, ai.move_z_axis);
  }

  //--------------------------------------------------------------------------
  // Move the gantry based on a distance and a computed feedrate that matches
  // a specific amount of time. This is used so that we can keep the movement
  // queue in sync with the joystick update intervals.
  //--------------------------------------------------------------------------
  jogGantry(x: number, y: number, z: number) {
    const dist = Math.sqrt(x * x + y * y + z * z); // travel distance
    const speed = (dist * 60000) / JOG_INTERVAL; // convert to mm/min
    this.gcodeSender.moveGantryJogToXYZ(x, y, z, speed);
    log.debug(
      LOGPREFIX,
      `jogGantry: x=${x}, y=${y}, z=${z}; distance=${dist} at ${speed} mm/min`
    );
  }
} // class Actions
