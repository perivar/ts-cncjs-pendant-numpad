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
import { KEY_CODE } from './keyboard-codes';
import { KeyboardEvent, NumpadController } from './numpad_controller';

//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'ACTIONS  '; // keep at 9 digits for consistency

const SINGLESTEP_LARGE_JOGDISTANCE = 10; // large jog step in mm
const SINGLESTEP_MEDIUM_JOGDISTANCE = 1; // medium jog step in mm
const SINGLESTEP_SMALL_JOGDISTANCE = 0.1; // small jog step in mm

const JOG_INTERVAL = 150; // default: 150, period in ms at which the $J jogging commands are sent to the machine
const JOG_XY_JOGSPEED = 2000; // default: 2000, mm/minute
const JOG_XY_JOGSTEP = JOG_XY_JOGSPEED * (JOG_INTERVAL / 60000); // mm/minute in terms of mm/interval
const JOG_Z_JOGSPEED = 500; // default: 500, mm/minute
const JOG_Z_JOGSTEP = JOG_Z_JOGSPEED * (JOG_INTERVAL / 60000); // mm/minute in terms of mm/interval

//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
export const DEFAULT_MOVE_DISTANCE = SINGLESTEP_MEDIUM_JOGDISTANCE;
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

//------------------------------------------------------------------------------
// Main module - provided access to command line options.
//------------------------------------------------------------------------------
export class Actions {
  connector: Connector; // connection to CNCjs
  numpadController: NumpadController; // connection to numpad
  options: Options; // program-wide options
  gcodeSender: GcodeSender; // abstraction interface

  numpadState: NumpadState; // state of current numpad
  axisInstructions = new XYZCoords(); // next jog movement instructions

  jogTimer: NodeJS.Timer; // jog timer reference
  joggingAck = true; // jog acknowledgement (true or false), start with it OK

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

    // listen for ok results to know that jogging worked
    this.connector.subscribeMessage('serialport:read', (data: string) => {
      if (
        !this.joggingAck &&
        (data.startsWith('ok') || data.startsWith('error:15')) // Error 15: Travel exceeded	Jog target exceeds machine travel. Jog command has been ignored.
      ) {
        log.debug(
          LOGPREFIX,
          `Received data: ${data}, setting joggingAck to true`
        );
        this.joggingAck = true;
      }
    });

    // start jogging timer
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
    const useJogging = true;

    const ai = new XYZCoords(); // mm to move each axis.

    // Get move distance modifier
    const distance = this.numpadState.moveDistance;

    const keyCode = kbdevent.key;
    const keyHex = kbdevent.key.toString(16);

    log.info(
      LOGPREFIX,
      `Received keyCode: 0x${keyHex} = ${keyCode}, current move distance: ${distance}, useJogging: ${useJogging}`
    );

    //------------------------------------------------------------
    // Determine appropriate jog values for the axes X and Y.
    // This isn't enabling motion yet, just selecting a speed in
    // case we select motion later.
    //------------------------------------------------------------
    const jogVelocity = JOG_XY_JOGSTEP;
    const jogDistance = distance / 10;

    //------------------------------------------------------------
    // Determine appropriate jog values for the Z axis.
    // This isn't enabling motion yet, just selecting a speed in case we
    // select motion later, so it doesn't matter if the key we're
    // testing is doing something else this round.
    //------------------------------------------------------------
    const jogVelocityZ = JOG_Z_JOGSTEP;
    const jogDistanceZ = distance / 10;

    switch (keyCode) {
      case KEY_CODE.KPMINUS: // -                  (z axis up)
        if (useJogging) {
          ai.move_z_axis = +jogDistanceZ * jogVelocityZ;
        } else {
          this.gcodeSender.moveGantryRelative(0, 0, +distance);
        }
        break;
      case KEY_CODE.KPPLUS: // +                   (z axis down)
        if (useJogging) {
          ai.move_z_axis = -jogDistanceZ * jogVelocityZ;
        } else {
          this.gcodeSender.moveGantryRelative(0, 0, -distance);
        }
        break;
      case KEY_CODE.KP4: // arrow: left (4)        (move -X)
        if (useJogging) {
          ai.move_x_axis = -jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(-distance, 0, 0);
        }
        break;
      case KEY_CODE.KP6: // arrow: right (6)       (move +X)
        if (useJogging) {
          ai.move_x_axis = +jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(+distance, 0, 0);
        }
        break;
      case KEY_CODE.KP8: // arrow: up (8)          (move +Y)
        if (useJogging) {
          ai.move_y_axis = +jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(0, +distance, 0);
        }
        break;
      case KEY_CODE.KP2: // arrow: down (2)        (move -Y)
        if (useJogging) {
          ai.move_y_axis = -jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(0, -distance, 0);
        }
        break;
      case KEY_CODE.KP1: // arrow: End (1)         (move -X and -Y)
        if (useJogging) {
          ai.move_x_axis = -jogDistance * jogVelocity;
          ai.move_y_axis = -jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(-distance, -distance, 0);
        }
        break;
      case KEY_CODE.KP9: // arrow: Page up (9)     (move +X and +Y)
        if (useJogging) {
          ai.move_x_axis = +jogDistance * jogVelocity;
          ai.move_y_axis = +jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(+distance, +distance, 0);
        }
        break;
      case KEY_CODE.KP3: // arrow: Page Down (3)   (move +X and -Y)
        if (useJogging) {
          ai.move_x_axis = +jogDistance * jogVelocity;
          ai.move_y_axis = -jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(+distance, -distance, 0);
        }
        break;
      case KEY_CODE.KP7: // Key 7: Home (7)        (move -X and +Y)
        if (useJogging) {
          ai.move_x_axis = -jogDistance * jogVelocity;
          ai.move_y_axis = +jogDistance * jogVelocity;
        } else {
          this.gcodeSender.moveGantryRelative(-distance, +distance, 0);
        }
        break;
      case KEY_CODE.KP5: // Key: 5                 (move to work home)
        this.gcodeSender.moveGantryWCSHomeXY();
        break;
      case KEY_CODE.TAB: // Key: Tab               (set work position to zero)
        this.gcodeSender.recordGantryZeroWCSX();
        this.gcodeSender.recordGantryZeroWCSY();
        this.gcodeSender.recordGantryZeroWCSZ();
        break;
      case KEY_CODE.KP0: // Key: 0                 (unlock)
        this.gcodeSender.controllerUnlock();
        break;
      case KEY_CODE.KPDOT: // Key: Period/Comma    (probe)
        this.gcodeSender.performZProbingTwice();
        break;
      case KEY_CODE.KPENTER: // Key: Enter         (homing)
        this.gcodeSender.performHoming();
        break;
      case KEY_CODE.NUMLOCK: // Numlock            (set work position for x and y to zero)
        this.gcodeSender.recordGantryZeroWCSX();
        this.gcodeSender.recordGantryZeroWCSY();
        break;
      case KEY_CODE.KPSLASH: // key: /             (set move distance to 0.1)
        this.numpadState.moveDistance = SINGLESTEP_SMALL_JOGDISTANCE;
        break;
      case KEY_CODE.KPASTERISK: // key: *          (set move distance to 1)
        this.numpadState.moveDistance = SINGLESTEP_MEDIUM_JOGDISTANCE;
        break;
      case KEY_CODE.BACKSPACE: // key: Backspace    (set move distance to 10)
        this.numpadState.moveDistance = SINGLESTEP_LARGE_JOGDISTANCE;
        break;
      case KEY_CODE.NONE:
        ai.move_x_axis = 0;
        ai.move_y_axis = 0;
        ai.move_z_axis = 0;
        break;
      default:
        break;
    }

    // store last pressed key in state
    if (keyCode !== KEY_CODE.NONE) {
      this.numpadState.previousKeyCode = keyCode;
    }

    //==================================================
    // The timer function will pick these up and act
    // accordingly.
    //==================================================
    this.axisInstructions = ai;
  }

  //--------------------------------------------------------------------------
  // We don't have continuous control over motors, so the best that we can
  // do is move them a certain distance for fixed periods of time. We will
  // simulate constant movement by sending new move commands at a fixed
  // frequency, when enabled.
  //--------------------------------------------------------------------------
  jogFunction() {
    const ai = this.axisInstructions as XYZCoords;

    log.trace(
      LOGPREFIX,
      'jogFunction',
      `Heartbeat, serialConnected: ${this.connector.serialConnected}, joggingAck: ${this.joggingAck}`
    );

    // if joggingAck is false, check back in 50% time
    this.jogTimer = setTimeout(
      this.jogFunction.bind(this),
      JOG_INTERVAL * (this.joggingAck ? 1 : 0.5)
    );

    if (Object.keys(ai).length === 0) return;
    if (ai.move_x_axis === 0 && ai.move_y_axis === 0 && ai.move_z_axis == 0)
      return;

    if (this.joggingAck) {
      this.jogGantry(ai.move_x_axis, ai.move_y_axis, ai.move_z_axis);
      this.joggingAck = false;
    }
  }

  //--------------------------------------------------------------------------
  // Move the gantry based on a distance and a computed feedrate that matches
  // a specific amount of time. This is used so that we can keep the movement
  // queue in sync with the key update intervals.
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
