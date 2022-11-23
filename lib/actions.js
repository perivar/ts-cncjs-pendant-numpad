#!/usr/bin/env node
"use strict";
// actions
// A module that creates actions based on input from the numpad and
// sends them to a socket server (typically CNCjs) to execute them.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Actions = void 0;
const npmlog_1 = __importDefault(require("npmlog"));
const gcode_grbl_1 = require("./gcode-grbl");
const gcode_marlin_1 = require("./gcode-marlin");
const numpad_controller_1 = require("./numpad_controller");
//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'ACTIONS  '; // keep at 9 digits for consistency
//------------------------------------------------------------------------------
// Main module - provided access to command line options.
//------------------------------------------------------------------------------
class Actions {
    //----------------------------------------------------------------------------
    // constructor()
    //----------------------------------------------------------------------------
    constructor(connector, options) {
        this.connector = connector;
        this.numpadController = connector.numpadController;
        this.options = options;
        this.gcodeSender = this.newGcodeSender();
        this.numpadState = {
            moveDistance: numpad_controller_1.DEFAULT_MOVE_DISTANCE, // Alter by F1, F2, F3
        };
        // listen for use events
        this.numpadController.on('use', this.onUse.bind(this));
    }
    //----------------------------------------------------------------------------
    // createGcodeSender()
    // Create an instance of the appropriate Gcode sender.
    //----------------------------------------------------------------------------
    newGcodeSender() {
        let gcode;
        switch (this.options.controllerType.toLowerCase()) {
            case 'grbl':
                gcode = gcode_grbl_1.GcodeGrbl;
                break;
            case 'marlin':
                gcode = gcode_marlin_1.GcodeMarlin;
                break;
            default:
                npmlog_1.default.error(LOGPREFIX, `Controller type ${this.options.controllerType} unknown; unable to continue`);
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
    onUse(kbdevent) {
        // Calculate move distance modifier
        const distance = this.numpadState.moveDistance;
        npmlog_1.default.info(LOGPREFIX, `key: ${kbdevent.key}, move distance: ${distance}`);
        switch (kbdevent.key) {
            case 86: // -                     (z axis up)
                this.gcodeSender.moveGantryRelative(0, 0, +distance, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 87: // +                     (z axis down)
                this.gcodeSender.moveGantryRelative(0, 0, -distance, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 92: // arrow: left (4)       (move -X)
                this.gcodeSender.moveGantryRelative(-distance, 0, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 94: // arrow: right (6)      (move +X)
                this.gcodeSender.moveGantryRelative(+distance, 0, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 96: // arrow: up (8)         (move +Y)
                this.gcodeSender.moveGantryRelative(0, +distance, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 90: // arrow: down (2)       (move -Y)
                this.gcodeSender.moveGantryRelative(0, -distance, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 89: // arrow: End (1)        (move -X and -Y)
                this.gcodeSender.moveGantryRelative(-distance, -distance, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 97: // arrow: Page up (9)    (move +X and +Y)
                this.gcodeSender.moveGantryRelative(+distance, +distance, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 91: // arrow: Page Down (3)  (move +X and -Y)
                this.gcodeSender.moveGantryRelative(+distance, -distance, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 95: // Key 7: Home (7)       (move -X and +Y)
                this.gcodeSender.moveGantryRelative(-distance, +distance, 0, numpad_controller_1.DEFAULT_MM_PER_MIN);
                break;
            case 93: // Key: 5                (move to work home)
                this.gcodeSender.moveGantryWCSHomeXY();
                break;
            case 43: // Key: Tab              (stop)
                this.gcodeSender.controllerStop();
                break;
            case 98: // Key: 0                (unlock)
                this.gcodeSender.controllerUnlock();
                break;
            case 99: // Key: Comma            (probe)
                this.gcodeSender.performZProbing();
                break;
            case 88: // Key: Enter            (homing)
                this.gcodeSender.performHoming();
                break;
            case 83: // Numlock               (set work position for x and y to zero)
                this.gcodeSender.recordGantryZeroWCSX();
                this.gcodeSender.recordGantryZeroWCSY();
                break;
            case 84: // key: /                (set move distance to 0.1)
                this.numpadState.moveDistance = 0.1;
                break;
            case 85: // key: *                (set move distance to 1)
                this.numpadState.moveDistance = 1;
                break;
            case 42: // key: Backspace        (set move distance to 10)
                this.numpadState.moveDistance = 10;
                break;
            default:
                break;
        }
    }
} // class Actions
exports.Actions = Actions;
