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
import { GcodeGrbl } from './gcode-grbl.js';
import { GcodeMarlin } from './gcode-marlin.js';
import { GcodeSender } from './gcode-sender.js';
import { KeyboardEvent, NumpadController } from './numpad_controller';

//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'ACTIONS  '; // keep at 9 digits for consistency

//----------------------------------------------------------------------------
// Interface definitions.
//----------------------------------------------------------------------------
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

  //----------------------------------------------------------------------------
  // constructor()
  //----------------------------------------------------------------------------
  constructor(connector: Connector, options: Options) {
    this.connector = connector;
    this.numpadController = connector.numpadController;
    this.options = options;
    this.gcodeSender = this.newGcodeSender();

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
    // Calculate move size modifiers
    kbdevent.move = kbdevent.default_move;

    log.info(LOGPREFIX, `key: ${kbdevent.key}`);

    switch (kbdevent.key) {
      case 86: // -                 (z axis up)
        this.gcodeSender.moveGantryRelative(0, 0, +kbdevent.move, 2000);
        break;
      case 87: // +                 (z axis down)
        this.gcodeSender.moveGantryRelative(0, 0, -kbdevent.move, 2000);
        break;
      case 92: // arrow: left (4)   (move -X)
        this.gcodeSender.moveGantryRelative(-kbdevent.move, 0, 0, 2000);
        break;
      case 94: // arrow: right (6)  (move +X)
        this.gcodeSender.moveGantryRelative(+kbdevent.move, 0, 0, 2000);
        break;
      case 96: // arrow: up (8)     (move +Y)
        this.gcodeSender.moveGantryRelative(0, +kbdevent.move, 0, 2000);
        break;
      case 90: // arrow: down (2)   (move -Y)
        this.gcodeSender.moveGantryRelative(0, -kbdevent.move, 0, 2000);
        break;
      case 89: // arrow: End (1)    (move -X and -Y)
        this.gcodeSender.moveGantryRelative(
          -kbdevent.move,
          -kbdevent.move,
          0,
          2000
        );
        break;
      case 97: // arrow: Page up (9) (move +X and +Y)
        this.gcodeSender.moveGantryRelative(
          +kbdevent.move,
          +kbdevent.move,
          0,
          2000
        );
        break;
      case 91: // arrow: Page Down (3) (move +X and -Y)
        this.gcodeSender.moveGantryRelative(
          +kbdevent.move,
          -kbdevent.move,
          0,
          2000
        );
        break;
      case 95: // Key 7: Home (7)  (move -X and +Y)
        this.gcodeSender.moveGantryRelative(
          -kbdevent.move,
          +kbdevent.move,
          0,
          2000
        );
        break;
      case 93: // Key: 5        (move to work home)
        this.gcodeSender.moveGantryWCSHomeXY();
        break;
      case 43: // Key: Tab      (stop)
        this.gcodeSender.controllerStop();
        break;
      case 98: // Key: 0        (unlock)
        this.gcodeSender.controllerUnlock();
        break;
      case 99: // Key: Comma    (probe)
        this.gcodeSender.performZProbing();
        break;
      case 88: // Key: Enter    (homing)
        this.gcodeSender.performHoming();
        break;
      case 83: // Numlock        (Set Work Position for X and Y to zero)
        this.gcodeSender.recordGantryZeroWCSX();
        this.gcodeSender.recordGantryZeroWCSY();
        break;
      case 84: // key: /
        kbdevent.default_move = 0.1;
        break;
      case 85: // key: *
        kbdevent.default_move = 1;
        break;
      case 42: // key: Backspace
        kbdevent.default_move = 10;
        break;
      default:
        break;
    }
  }
} // class Actions
