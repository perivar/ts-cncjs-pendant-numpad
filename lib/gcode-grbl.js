#!/usr/bin/env node
"use strict";
// gcode-grbl
// G-code handler for Grbl controllers. Sends messages to CNCjs via the
// connector service based on input from the actions service.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcodeGrbl = void 0;
const npmlog_1 = __importDefault(require("npmlog"));
const gcode_sender_1 = require("./gcode-sender");
//----------------------------------------------------------------------------
// Constant definitions.
//----------------------------------------------------------------------------
const LOGPREFIX = 'GCODEGRBL'; // keep at 9 digits for consistency
//----------------------------------------------------------------------------
// class GcodeGrbl
//----------------------------------------------------------------------------
class GcodeGrbl extends gcode_sender_1.GcodeSender {
    //----------------------------------------------------------------------------
    // Override the constructor to subscribe to serial port read messages, so
    // that we can react to grbl-specific messages.
    //----------------------------------------------------------------------------
    constructor(actions) {
        super(actions);
        this.zProbeRecord = new ZProbeRecord();
        // listen for probe results and trigger setting the z position
        this.connector.subscribeMessage('serialport:read', (data) => {
            if (this.zProbeRecord.isValidString(data)) {
                npmlog_1.default.info(LOGPREFIX, `Trying to read probe string: ${data}`);
                this.zProbeRecord.updateFromString(data);
                if (this.zProbeRecord.success) {
                    npmlog_1.default.info(LOGPREFIX, `Probe data found: [X${this.zProbeRecord.x} Y${this.zProbeRecord.y} Z${this.zProbeRecord.z}]`);
                    // disable the setting of new z position, but keep the recording of the probe position
                    /*
                        const dz = Number(this.options.zProbeThickness);
                        this.sendMessage('command', 'gcode', 'G91'); // relative coordinates
                        this.sendMessage('command', 'gcode', `G10 L20 P1 Z${dz}`); // state that current Z is `dz`
                        this.sendMessage(
                          'command',
                          'gcode',
                          `G0 Z${this.retractionDistance}`
                        ); // lift up just a bit
                        this.sendMessage('command', 'gcode', 'G90'); // back to absolute coordinates
                        */
                }
            }
        });
    }
    //----------------------------------------------------------------------------
    // move gantry: relative movement
    //  Override the base class implementation to use grbl-specific `$J=` jogging
    //  notation. We're also going to slow the speed down just slightly so that
    //  we can keep the planner full.
    //----------------------------------------------------------------------------
    moveGantryJogToXYZ(x, y, z, mmPerMin = this.feedrate) {
        this.sendMessage('command', 'gcode', 'G21'); // set to millimeters
        this.sendMessage('command', 'gcode', `G91`);
        this.sendMessage('command', 'gcode', `$J=X${x.toFixed(4)} Y${y.toFixed(4)} Z${z.toFixed(4)} F${mmPerMin * 0.98}`);
        this.sendMessage('command', 'gcode', 'G90'); // back to absolute coordinates
    }
    //----------------------------------------------------------------------------
    // move gantry: z probe position
    //  The base class doesn't provide this, but this override uses some grbl
    //  specific sniffing to know where the last probe position occurred. In
    //  general for hobby CNC, this is probably where the Z was last probed.
    //  This lets us go back and probe Z again at the same XY position for
    //  subsequent operations.
    //----------------------------------------------------------------------------
    moveGantryZProbePos() {
        if (this.zProbeRecord.success) {
            this.sendMessage('command', 'gcode', `G53 G0 G90 Z${this.zsafepos}`);
            this.sendMessage('command', 'gcode', `G54 G0 G90 X${this.zProbeRecord.x} Y${this.zProbeRecord.y}`);
        }
    }
} // class GcodeGrbl;
exports.GcodeGrbl = GcodeGrbl;
//----------------------------------------------------------------------------
// Instances of this class keep a record of the Z Probe position as they
// come in.
//----------------------------------------------------------------------------
class ZProbeRecord {
    //-------------------------------------------------------------
    // constructor()
    //-------------------------------------------------------------
    constructor() {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.success = false;
    } // constructor();
    //-------------------------------------------------------------
    // Determines whether or not the provided string is a valid
    // grbl PRB response string.
    //-------------------------------------------------------------
    isValidString(data) {
        return data.match(/^\[PRB:.*:\d\]$/) != null;
    } // isValidString()
    //-------------------------------------------------------------
    // Given a well formatted string, set our values from it.
    //-------------------------------------------------------------
    updateFromString(data) {
        if (!this.isValidString(data)) {
            npmlog_1.default.error('ZPROBEREC', `The string ${data} is NOT a correct record.`);
            return;
        }
        const valuesMatch = data.match(/:(.*):/);
        if (valuesMatch != null) {
            const values = valuesMatch[1].split(',');
            this.x = Number(values[0]);
            this.y = Number(values[1]);
            this.z = Number(values[2]);
        }
        const successMatch = data.match(/.*:(\d)/);
        if (successMatch != null) {
            const success = successMatch[1];
            this.success = Boolean(Number(success));
        }
    } // updateFromString()
} // class ZProbeRecord
