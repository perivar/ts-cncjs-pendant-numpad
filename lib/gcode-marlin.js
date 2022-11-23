#!/usr/bin/env node
"use strict";
// gcode-marlin
// G-code handler for Marlin controllers. Sends messages to CNCjs via the
// connector service based on input from the actions service.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcodeMarlin = void 0;
const gcode_sender_1 = require("./gcode-sender");
class GcodeMarlin extends gcode_sender_1.GcodeSender {
    performHoming() {
        this.sendMessage('command', 'gcode', 'G28 X Y');
    }
    performZProbing() {
        this.sendMessage('command', 'gcode', 'M28 Z'); // use a simple touch plate
    }
}
exports.GcodeMarlin = GcodeMarlin;
