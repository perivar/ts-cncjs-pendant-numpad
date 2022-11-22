#!/usr/bin/env node
"use strict";
// actions
// A module that creates actions based on input from the numpad controller and
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
const gcode_grbl_js_1 = require("./gcode-grbl.js");
const gcode_marlin_js_1 = require("./gcode-marlin.js");
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
                gcode = gcode_grbl_js_1.GcodeGrbl;
                break;
            case 'marlin':
                gcode = gcode_marlin_js_1.GcodeMarlin;
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
    onUse(keyCode, kbdevent) {
        // Calculate move size modifiers
        kbdevent.move = kbdevent.default_move;
        npmlog_1.default.info(LOGPREFIX, `key: ${kbdevent.key}`);
        switch (kbdevent.key) {
            case 87: // +             (z axis down)
                this.gcodeSender.moveGantryRelative(0, 0, -kbdevent.move, 2000);
                break;
            case 86: // -             (z axis up)
                this.gcodeSender.moveGantryRelative(0, 0, +kbdevent.move, 2000);
                break;
            case 92: // arrow: left   (move -X)
                this.gcodeSender.moveGantryRelative(-kbdevent.move, 0, 0, 2000);
                break;
            case 94: // arrow: right  (move +X)
                this.gcodeSender.moveGantryRelative(+kbdevent.move, 0, 0, 2000);
                break;
            case 96: // arrow: up     (move +Y)
                this.gcodeSender.moveGantryRelative(0, +kbdevent.move, 0, 2000);
                break;
            case 90: // arrow: down   (move -Y)
                this.gcodeSender.moveGantryRelative(0, -kbdevent.move, 0, 2000);
                break;
            case 89: // arrow: End    (move -X and -Y)
                this.gcodeSender.moveGantryRelative(-kbdevent.move, -kbdevent.move, 0, 2000);
                break;
            case 97: // arrow: Page up  (move +X and +Y)
                this.gcodeSender.moveGantryRelative(+kbdevent.move, +kbdevent.move, 0, 2000);
                break;
            case 91: // arrow: Page Down  (move +X and -Y)
                this.gcodeSender.moveGantryRelative(+kbdevent.move, -kbdevent.move, 0, 2000);
                break;
            case 95: // Key 7: Home  (move -X and +Y)
                this.gcodeSender.moveGantryRelative(-kbdevent.move, +kbdevent.move, 0, 2000);
                break;
            case 93: // Key: 5        (move to work home)
                this.gcodeSender.moveGantryWCSHomeXY();
                break;
            case 99: // . - Probe
                this.gcodeSender.performZProbing();
                break;
            case 83: // Set Work Position for X and Y to zero
                this.gcodeSender.recordGantryZeroWCSX();
                this.gcodeSender.recordGantryZeroWCSY();
                break;
            case 98: // Unlock
                this.gcodeSender.controllerUnlock();
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
            case 88: // Key: OK or Enter - HOMING
                this.gcodeSender.moveGantryHome();
                break;
            default:
                break;
        }
    }
} // class Actions
exports.Actions = Actions;
