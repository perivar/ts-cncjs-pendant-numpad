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
exports.Actions = exports.DEFAULT_MOVE_DISTANCE = void 0;
const npmlog_1 = __importDefault(require("npmlog"));
const gcode_grbl_1 = require("./gcode-grbl");
const gcode_marlin_1 = require("./gcode-marlin");
//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'ACTIONS  '; // keep at 9 digits for consistency
const SINGLESTEP_LARGE_JOGDISTANCE = 10; // large jog step in mm
const SINGLESTEP_MEDIUM_JOGDISTANCE = 1; // medium jog step in mm
const SINGLESTEP_SMALL_JOGDISTANCE = 0.1; // small jog step in mm
const SMOOTHJOG_COMMANDS_INTERVAL = 150; // period in ms at which the $J jogging commands are sent to the machine
const SMOOTHJOG_JOGSPEED = 2000; // mm per min
const SMOOTHJOG_JOGSTEP = SMOOTHJOG_JOGSPEED * (SMOOTHJOG_COMMANDS_INTERVAL / 60000);
//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
exports.DEFAULT_MOVE_DISTANCE = SINGLESTEP_MEDIUM_JOGDISTANCE;
// https://gist.github.com/Crenshinibon/5238119
// https://git.sr.ht/~sircmpwn/hare-sdl2/tree/7855e717d6af1b4f1e9ed15b7db9bda6686da954/item/sdl2/keyboard.ha
var KEY_CODES;
(function (KEY_CODES) {
    KEY_CODES[KEY_CODES["KEYCODE_UNKNOWN"] = 0] = "KEYCODE_UNKNOWN";
    KEY_CODES[KEY_CODES["RETURN"] = 40] = "RETURN";
    KEY_CODES[KEY_CODES["ESCAPE"] = 41] = "ESCAPE";
    KEY_CODES[KEY_CODES["BACKSPACE"] = 42] = "BACKSPACE";
    KEY_CODES[KEY_CODES["TAB"] = 43] = "TAB";
    KEY_CODES[KEY_CODES["SPACE"] = 44] = "SPACE";
    KEY_CODES[KEY_CODES["NUMLOCKCLEAR"] = 83] = "NUMLOCKCLEAR";
    KEY_CODES[KEY_CODES["KP_DIVIDE"] = 84] = "KP_DIVIDE";
    KEY_CODES[KEY_CODES["KP_MULTIPLY"] = 85] = "KP_MULTIPLY";
    KEY_CODES[KEY_CODES["KP_MINUS"] = 86] = "KP_MINUS";
    KEY_CODES[KEY_CODES["KP_PLUS"] = 87] = "KP_PLUS";
    KEY_CODES[KEY_CODES["KP_ENTER"] = 88] = "KP_ENTER";
    KEY_CODES[KEY_CODES["KP_1"] = 89] = "KP_1";
    KEY_CODES[KEY_CODES["KP_2"] = 90] = "KP_2";
    KEY_CODES[KEY_CODES["KP_3"] = 91] = "KP_3";
    KEY_CODES[KEY_CODES["KP_4"] = 92] = "KP_4";
    KEY_CODES[KEY_CODES["KP_5"] = 93] = "KP_5";
    KEY_CODES[KEY_CODES["KP_6"] = 94] = "KP_6";
    KEY_CODES[KEY_CODES["KP_7"] = 95] = "KP_7";
    KEY_CODES[KEY_CODES["KP_8"] = 96] = "KP_8";
    KEY_CODES[KEY_CODES["KP_9"] = 97] = "KP_9";
    KEY_CODES[KEY_CODES["KP_0"] = 98] = "KP_0";
    KEY_CODES[KEY_CODES["KP_PERIOD"] = 99] = "KP_PERIOD";
})(KEY_CODES || (KEY_CODES = {}));
//------------------------------------------------------------------------------
// Main module - provided access to command line options.
//------------------------------------------------------------------------------
class Actions {
    //----------------------------------------------------------------------------
    // constructor()
    //----------------------------------------------------------------------------
    constructor(connector, options) {
        this.smoothJogging = false;
        this.joggingAck = true;
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
                this.joggingAck = true;
            }
        });
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
        // Get move distance modifier
        let distance = this.numpadState.moveDistance;
        const keyCode = kbdevent.key;
        const keyHex = kbdevent.key.toString(16);
        npmlog_1.default.info(LOGPREFIX, `Receiveed keyCode: 0x${keyHex} = ${keyCode}, current move distance: ${distance}`);
        if (this.smoothJogging) {
            this.stopSmoothJog();
            return;
        }
        const isJogging = true;
        let jogSpeed = SMOOTHJOG_JOGSPEED;
        if (isJogging) {
            distance = SMOOTHJOG_JOGSTEP;
        }
        switch (keyCode) {
            case KEY_CODES.KP_MINUS: // -                  (z axis up)
                if (isJogging) {
                    distance *= 0.25;
                    jogSpeed *= 0.25;
                    this.startSmoothJog(0, 0, +distance, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, 0, +distance);
                }
                break;
            case KEY_CODES.KP_PLUS: // +                   (z axis down)
                if (isJogging) {
                    distance *= 0.25;
                    jogSpeed *= 0.25;
                    this.startSmoothJog(0, 0, -distance, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, 0, -distance);
                }
                break;
            case KEY_CODES.KP_4: // arrow: left (4)        (move -X)
                if (isJogging) {
                    this.startSmoothJog(-distance, 0, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(-distance, 0, 0);
                }
                break;
            case KEY_CODES.KP_6: // arrow: right (6)       (move +X)
                if (isJogging) {
                    this.startSmoothJog(+distance, 0, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(+distance, 0, 0);
                }
                break;
            case KEY_CODES.KP_8: // arrow: up (8)          (move +Y)
                if (isJogging) {
                    this.startSmoothJog(0, +distance, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, +distance, 0);
                }
                break;
            case KEY_CODES.KP_2: // arrow: down (2)        (move -Y)
                if (isJogging) {
                    this.startSmoothJog(0, -distance, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(0, -distance, 0);
                }
                break;
            case KEY_CODES.KP_1: // arrow: End (1)         (move -X and -Y)
                if (isJogging) {
                    this.startSmoothJog(-distance, -distance, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(-distance, -distance, 0);
                }
                break;
            case KEY_CODES.KP_9: // arrow: Page up (9)     (move +X and +Y)
                if (isJogging) {
                    this.startSmoothJog(+distance, +distance, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(+distance, +distance, 0);
                }
                break;
            case KEY_CODES.KP_3: // arrow: Page Down (3)   (move +X and -Y)
                if (isJogging) {
                    this.startSmoothJog(+distance, -distance, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(+distance, -distance, 0);
                }
                break;
            case KEY_CODES.KP_7: // Key 7: Home (7)        (move -X and +Y)
                if (isJogging) {
                    this.startSmoothJog(-distance, +distance, 0, jogSpeed);
                }
                else {
                    this.gcodeSender.moveGantryRelative(-distance, +distance, 0);
                }
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
                this.numpadState.moveDistance = SINGLESTEP_SMALL_JOGDISTANCE;
                break;
            case KEY_CODES.KP_MULTIPLY: // key: *          (set move distance to 1)
                this.numpadState.moveDistance = SINGLESTEP_MEDIUM_JOGDISTANCE;
                break;
            case KEY_CODES.BACKSPACE: // key: Backspace    (set move distance to 10)
                this.numpadState.moveDistance = SINGLESTEP_LARGE_JOGDISTANCE;
                break;
            case KEY_CODES.KEYCODE_UNKNOWN:
                this.smoothJogging = false;
                break;
            default:
                break;
        }
        // store current key in state
        if (keyCode !== KEY_CODES.KEYCODE_UNKNOWN) {
            this.numpadState.previousKeyCode = keyCode;
        }
    }
    smoothJog(x, y, z, jogSpeed, firstDelay = false) {
        if (!this.smoothJogging) {
            return;
        }
        let jogDelayModifier = 1;
        if (this.joggingAck) {
            this.gcodeSender.moveGantryJogToXYZ(x, y, z, jogSpeed);
            npmlog_1.default.debug(LOGPREFIX, `jogGantry: x=${x}, y=${y}, z=${z} at ${jogSpeed} mm/min`);
            this.joggingAck = false;
        }
        else {
            // check back in 50% time
            jogDelayModifier = 0.5;
        }
        // plan to resend a smooth jog command after a small delay to keep things going,
        // unless user asked to stop the smooth jog movement
        this.smoothJoggingTimer = setTimeout(this.smoothJog, SMOOTHJOG_COMMANDS_INTERVAL * jogDelayModifier - (firstDelay ? 50 : 0), x, y, z, jogSpeed);
    }
    startSmoothJog(x, y, z, jogSpeed) {
        if (!this.smoothJogging) {
            this.smoothJogging = true;
            this.smoothJog(x, y, z, jogSpeed, true);
        }
    }
    stopSmoothJog() {
        this.smoothJogging = false;
        clearTimeout(this.smoothJoggingTimer);
        this.connector.socket.emit('command', this.options.port, 'gcode', '\x85');
        npmlog_1.default.debug(LOGPREFIX, `Smooth jogging stopped!`);
    }
} // class Actions
exports.Actions = Actions;
