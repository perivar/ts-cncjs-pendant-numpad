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
exports.Actions = exports.XYZCoords = exports.DEFAULT_MOVE_DISTANCE = void 0;
const npmlog_1 = __importDefault(require("npmlog"));
const gcode_grbl_1 = require("./gcode-grbl");
const gcode_marlin_1 = require("./gcode-marlin");
const keyboard_codes_1 = require("./keyboard-codes");
//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'ACTIONS  '; // keep at 9 digits for consistency
const SINGLESTEP_LARGE_JOGDISTANCE = 10; // large jog step in mm
const SINGLESTEP_MEDIUM_JOGDISTANCE = 1; // medium jog step in mm
const SINGLESTEP_SMALL_JOGDISTANCE = 0.1; // small jog step in mm
const SMOOTHJOG_COMMANDS_INTERVAL = 150; // period in ms at which the $J jogging commands are sent to the machine
const SMOOTHJOG_JOGSPEED = 2000; // mm/minute
const SMOOTHJOG_JOGSTEP = SMOOTHJOG_JOGSPEED * (SMOOTHJOG_COMMANDS_INTERVAL / 60000); // mm/minute in terms of mm/interval
//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
exports.DEFAULT_MOVE_DISTANCE = SINGLESTEP_MEDIUM_JOGDISTANCE;
//----------------------------------------------------------------------------
// Interface definitions.
//----------------------------------------------------------------------------
// A simple record that indicates the next jogging motion destination.
class XYZCoords {
    constructor() {
        this.move_x_axis = 0.0;
        this.move_y_axis = 0.0;
        this.move_z_axis = 0.0;
    }
}
exports.XYZCoords = XYZCoords;
//------------------------------------------------------------------------------
// Main module - provided access to command line options.
//------------------------------------------------------------------------------
class Actions {
    //----------------------------------------------------------------------------
    // constructor()
    //----------------------------------------------------------------------------
    constructor(connector, options) {
        this.axisInstructions = new XYZCoords(); // next jog movement instructions
        this.connector = connector;
        this.numpadController = connector.numpadController;
        this.options = options;
        this.gcodeSender = this.newGcodeSender();
        this.numpadState = {
            moveDistance: exports.DEFAULT_MOVE_DISTANCE, // Alter by F1, F2, F3
        };
        // listen for use events
        this.numpadController.on('use', this.onUse.bind(this));
        // listen for ok results to know that jogging worked
        this.connector.subscribeMessage('serialport:read', (data) => {
            if (!this.joggingAck &&
                (data.startsWith('ok') || data.startsWith('error:15')) // Error 15: Travel exceeded	Jog target exceeds machine travel. Jog command has been ignored.
            ) {
                npmlog_1.default.debug(LOGPREFIX, `Received data: ${data}, setting joggingAck to true`);
                this.joggingAck = true;
            }
        });
        // start jogging timer
        this.joggingAck = true;
        this.smoothJoggingTimer = setTimeout(this.jogFunction.bind(this), SMOOTHJOG_COMMANDS_INTERVAL);
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
        const useJogging = true;
        const ai = new XYZCoords(); // mm to move each axis.
        // Get move distance modifier
        const distance = this.numpadState.moveDistance;
        const keyCode = kbdevent.key;
        const keyHex = kbdevent.key.toString(16);
        npmlog_1.default.info(LOGPREFIX, `Received keyCode: 0x${keyHex} = ${keyCode}, current move distance: ${distance}, useJogging: ${useJogging}`);
        //------------------------------------------------------------
        // Determine appropriate jog values for the axes X and Y.
        // This isn't enabling motion yet, just selecting a speed in
        // case we select motion later.
        //------------------------------------------------------------
        //const jogVelocity = SMOOTHJOG_JOGSPEED;
        //const jogDistance = SMOOTHJOG_JOGSTEP;
        const jogVelocity = SMOOTHJOG_JOGSTEP;
        const jogDistance = distance / 10;
        //------------------------------------------------------------
        // Determine appropriate jog values for the Z axis.
        // This isn't enabling motion yet, just selecting a speed in case we
        // select motion later, so it doesn't matter if the key we're
        // testing is doing something else this round.
        //------------------------------------------------------------
        const jogVelocityZ = SMOOTHJOG_JOGSPEED * 0.25;
        const jogDistanceZ = SMOOTHJOG_JOGSTEP * 0.25;
        switch (keyCode) {
            case keyboard_codes_1.KEY_CODE.KPMINUS: // -                  (z axis up)
                if (useJogging) {
                    ai.move_z_axis = +jogDistanceZ * jogVelocityZ;
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, 0, +distance);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KPPLUS: // +                   (z axis down)
                if (useJogging) {
                    ai.move_z_axis = -jogDistanceZ * jogVelocityZ;
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, 0, -distance);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP4: // arrow: left (4)        (move -X)
                if (useJogging) {
                    ai.move_x_axis = -jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(-distance, 0, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP6: // arrow: right (6)       (move +X)
                if (useJogging) {
                    ai.move_x_axis = +jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(+distance, 0, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP8: // arrow: up (8)          (move +Y)
                if (useJogging) {
                    ai.move_y_axis = +jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, +distance, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP2: // arrow: down (2)        (move -Y)
                if (useJogging) {
                    ai.move_y_axis = -jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, -distance, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP1: // arrow: End (1)         (move -X and -Y)
                if (useJogging) {
                    ai.move_x_axis = -jogDistance * jogVelocity;
                    ai.move_y_axis = -jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(-distance, -distance, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP9: // arrow: Page up (9)     (move +X and +Y)
                if (useJogging) {
                    ai.move_x_axis = +jogDistance * jogVelocity;
                    ai.move_y_axis = +jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(+distance, +distance, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP3: // arrow: Page Down (3)   (move +X and -Y)
                if (useJogging) {
                    ai.move_x_axis = +jogDistance * jogVelocity;
                    ai.move_y_axis = -jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(+distance, -distance, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP7: // Key 7: Home (7)        (move -X and +Y)
                if (useJogging) {
                    ai.move_x_axis = -jogDistance * jogVelocity;
                    ai.move_y_axis = +jogDistance * jogVelocity;
                }
                else {
                    this.gcodeSender.moveGantryRelative(-distance, +distance, 0);
                }
                break;
            case keyboard_codes_1.KEY_CODE.KP5: // Key: 5                 (move to work home)
                this.gcodeSender.moveGantryWCSHomeXY();
                break;
            case keyboard_codes_1.KEY_CODE.TAB: // Key: Tab               (set work position to zero)
                this.gcodeSender.recordGantryZeroWCSX();
                this.gcodeSender.recordGantryZeroWCSY();
                this.gcodeSender.recordGantryZeroWCSZ();
                break;
            case keyboard_codes_1.KEY_CODE.KP0: // Key: 0                 (unlock)
                this.gcodeSender.controllerUnlock();
                break;
            case keyboard_codes_1.KEY_CODE.KPDOT: // Key: Period/Comma    (probe)
                this.gcodeSender.performZProbingTwice();
                break;
            case keyboard_codes_1.KEY_CODE.KPENTER: // Key: Enter         (homing)
                this.gcodeSender.performHoming();
                break;
            case keyboard_codes_1.KEY_CODE.NUMLOCK: // Numlock            (set work position for x and y to zero)
                this.gcodeSender.recordGantryZeroWCSX();
                this.gcodeSender.recordGantryZeroWCSY();
                break;
            case keyboard_codes_1.KEY_CODE.KPSLASH: // key: /             (set move distance to 0.1)
                this.numpadState.moveDistance = SINGLESTEP_SMALL_JOGDISTANCE;
                break;
            case keyboard_codes_1.KEY_CODE.KPASTERISK: // key: *          (set move distance to 1)
                this.numpadState.moveDistance = SINGLESTEP_MEDIUM_JOGDISTANCE;
                break;
            case keyboard_codes_1.KEY_CODE.BACKSPACE: // key: Backspace    (set move distance to 10)
                this.numpadState.moveDistance = SINGLESTEP_LARGE_JOGDISTANCE;
                break;
            case keyboard_codes_1.KEY_CODE.NONE:
                ai.move_x_axis = 0;
                ai.move_y_axis = 0;
                ai.move_z_axis = 0;
                break;
            default:
                break;
        }
        // store last pressed key in state
        if (keyCode !== keyboard_codes_1.KEY_CODE.NONE) {
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
        const ai = this.axisInstructions;
        npmlog_1.default.trace(LOGPREFIX, 'jogFunction', `Heartbeat, serialConnected: ${this.connector.serialConnected}, joggingAck: ${this.joggingAck}`);
        // if joggingAck is false, check back in 50% time
        this.smoothJoggingTimer = setTimeout(this.jogFunction.bind(this), SMOOTHJOG_COMMANDS_INTERVAL * (this.joggingAck ? 1 : 0.5));
        if (Object.keys(ai).length === 0)
            return;
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
    jogGantry(x, y, z) {
        const dist = Math.sqrt(x * x + y * y + z * z); // travel distance
        const speed = (dist * 60000) / SMOOTHJOG_COMMANDS_INTERVAL; // convert to mm/min
        this.gcodeSender.moveGantryJogToXYZ(x, y, z, speed);
        npmlog_1.default.debug(LOGPREFIX, `jogGantry: x=${x}, y=${y}, z=${z}; distance=${dist} at ${speed} mm/min`);
    }
} // class Actions
exports.Actions = Actions;
