#!/usr/bin/env node
"use strict";
// actions
// A module that uses a NumPad
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NumpadController = exports.findHID = void 0;
const events_1 = require("events");
const node_hid_1 = __importDefault(require("node-hid"));
const npmlog_1 = __importDefault(require("npmlog"));
const keyboard_codes_1 = require("./keyboard-codes");
//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'NUMPAD   '; // keep at 9 digits for consistency
const findHID = (vendorId, productId, interfaceNumber) => {
    // return undefined if no vendorId or productId is passed
    if (!vendorId || !productId) {
        npmlog_1.default.error(LOGPREFIX, `Missing vendor or productid. VID:PID: ${vendorId}:${productId}`);
        return undefined;
    }
    npmlog_1.default.info(LOGPREFIX, `Looking for HID device with VID:PID: ${vendorId}:${productId}`);
    const devices = node_hid_1.default.devices();
    const deviceInfo = devices.find(item => {
        if (interfaceNumber) {
            return (item.vendorId === Number(vendorId) &&
                item.productId === Number(productId) &&
                item.interface === Number(interfaceNumber));
        }
        else {
            return (item.vendorId === Number(vendorId) &&
                item.productId === Number(productId));
        }
    });
    if (deviceInfo) {
        npmlog_1.default.info(LOGPREFIX, `Successfully found HID device with VID:PID: ${vendorId}:${productId}`);
        return deviceInfo;
    }
    else {
        npmlog_1.default.info(LOGPREFIX, `Failed finding HID device with VID:PID: ${vendorId}:${productId}`);
        return undefined;
    }
};
exports.findHID = findHID;
//------------------------------------------------------------------------------
// Instances of this class receive events and event records when numpad
// events occur. Consult the events you can subscribe to in the `on())`
// function.
//------------------------------------------------------------------------------
class NumpadController {
    constructor(options) {
        this.connected = false;
        this.events = new events_1.EventEmitter.EventEmitter();
        this.options = options;
        // find keyboard with index 0
        const hidDevice = (0, exports.findHID)(options.vendorId, options.productId, 0);
        if (!hidDevice) {
            npmlog_1.default.error(LOGPREFIX, `No keyboard found!`);
            if (!options.simulate)
                process.exit(1);
        }
        else {
            const keyboardHIDAddress = hidDevice.path;
            if (!keyboardHIDAddress) {
                npmlog_1.default.error(LOGPREFIX, `No keyboard address found.`);
                if (!options.simulate)
                    process.exit(1);
            }
            else {
                npmlog_1.default.info(LOGPREFIX, 'Opening keyboard using HID address:', keyboardHIDAddress);
                try {
                    this.keyboard = new node_hid_1.default.HID(keyboardHIDAddress);
                    // Listen for numpad data events
                    this.keyboard.on('data', this.keyboardEventOn.bind(this));
                    // Listen for numpad error events
                    this.keyboard.on('error', err => {
                        npmlog_1.default.error(LOGPREFIX, `Keyboard unplugged? ` + err);
                        // inform the listeners that we have detached the numpad
                        this.connected = false;
                        this.events.emit('remove');
                        if (!options.simulate)
                            process.exit(1);
                    });
                    // inform the listeners that we have attached the numpad
                    this.connected = true;
                    this.events.emit('attach');
                }
                catch (err) {
                    npmlog_1.default.error(LOGPREFIX, `Could not connect to keyboard.`);
                    if (!options.simulate)
                        process.exit(1);
                }
            }
        }
        if (!this.connected && options.simulate) {
            npmlog_1.default.info(LOGPREFIX, `Simulating a connected keyboard.`);
            this.connected = true;
            this.events.emit('attach');
        }
    }
    keyboardEventOn(data) {
        // The codes in the buffer are HID reports from a typical USB keyboard.
        // They are described in the Universal Serial Bus HID Usage Tables document in Chapter 10
        // "Keyboard/Keypad Page (0x07)".
        // The format of each report depends on the report descriptor but it is almost always:
        // 1 byte modifiers (ctrl, alt, etc),
        // 1 byte reserved,
        // 6 bytes representing up to 6 simultaneous keys being pressed.
        // A report containing all zeros means "no keys are currently being pressed".
        const recv = data.toJSON().data;
        const bits = recv.shift(); // remove first element from array and returns that removed element
        const kbdevent = {
            l_control: (bits & keyboard_codes_1.KEY_MOD.LCTRL) !== 0 && bits <= 128,
            l_shift: (bits & keyboard_codes_1.KEY_MOD.LSHIFT) !== 0 && bits <= 128,
            l_alt: (bits & keyboard_codes_1.KEY_MOD.LALT) !== 0 && bits <= 128,
            l_meta: (bits & keyboard_codes_1.KEY_MOD.LMETA) !== 0 && bits <= 128,
            r_control: (bits & keyboard_codes_1.KEY_MOD.RCTRL) !== 0 && bits <= 128,
            r_shift: (bits & keyboard_codes_1.KEY_MOD.RSHIFT) !== 0 && bits <= 128,
            r_alt: (bits & keyboard_codes_1.KEY_MOD.RALT) !== 0 && bits <= 128,
            r_meta: (bits & keyboard_codes_1.KEY_MOD.RMETA) !== 0 && bits <= 128,
            key: keyboard_codes_1.KEY_CODE.NONE, // Normal keys
        };
        recv.shift(); // ignore reserved byte
        kbdevent.key = recv.shift(); // remove first element from array and returns that removed element
        if (kbdevent.key == 0 && bits > 128) {
            kbdevent.key = bits;
        }
        const keyCode = kbdevent.key;
        const keyHex = kbdevent.key.toString(16);
        npmlog_1.default.info(LOGPREFIX, `Sending keyCode: 0x${keyHex} = ${keyCode}`);
        this.events.emit('use', kbdevent);
    }
    // subscribe to a numpad event
    on(eventName, handler) {
        switch (eventName) {
            case 'attach':
            case 'remove':
            case 'use':
                break;
            default:
                npmlog_1.default.error(LOGPREFIX, `NumpadController.on unknown event ${eventName}`);
                return;
        }
        this.events.on(eventName, handler);
        // if this is an attach event, and we already have a controller, let them know
        if (eventName == 'attach' && this.connected)
            this.events.emit('attach');
    }
    // unsubscribed from a numpad event
    off(eventName, handler) {
        this.events.off(eventName, handler);
    }
    // determine if we have a valid numpad connected
    isConnected() {
        return this.connected;
    }
}
exports.NumpadController = NumpadController;
