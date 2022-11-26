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

//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
export const DEFAULT_MOVE_DISTANCE = 1;
interface NumpadState {
  moveDistance: number;
}

//----------------------------------------------------------------------------
// Interface definitions.
//----------------------------------------------------------------------------
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
  numpadState: NumpadState; // state of current numpad

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
    // Get move distance modifier
    const distance = this.numpadState.moveDistance;

    const keyCode = kbdevent.key;
    const keyHex = kbdevent.key.toString(16);
    log.info(
      LOGPREFIX,
      `Receiveed keyCode: 0x${keyHex} = ${keyCode}, current move distance: ${distance}`
    );

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
  }
} // class Actions
