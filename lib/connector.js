#!/usr/bin/env node
"use strict";
// connector
// A module that connects to a CNCjs instance via websockets, and maintains
// a virtual serial connection via that socket to a connected CNC machine.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Connector = void 0;
const fs = __importStar(require("fs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const npmlog_1 = __importDefault(require("npmlog"));
const path = __importStar(require("path"));
// Note: don't be tempted to update package.json to the newest version of
// socket.io-client; its version must match the version in use by CNCjs, which is 2.x.
const socket_io_client_1 = __importDefault(require("socket.io-client"));
const timers_1 = require("timers");
//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'CONNECTOR'; // keep at 9 digits for consistency
//----------------------------------------------------------------------------
// This class maintains connections to the local instance of CNCjs via its
// socket connection, as well as to the serial port in use by CNCjs. Once set
// up, we're just waiting for events to cause our other methods to fire.
// Essentially, what's going to happen is this:
// - If there are no controllers connected, then wait for one to connect.
// - Upon connecting at least one controller, establish socket.
// - Upon losing all controllers, disconnect socket, stop everything that
//   can be stopped, then wait for a connection again.
// - When a controller is connected, it will signal callbacks.
//----------------------------------------------------------------------------
class Connector {
    constructor(numpadController, options) {
        this.serialConnected = false;
        this.awaitingString = 'Waiting for a numpad to be connected.';
        this.numpadController = numpadController;
        this.options = options;
        this.logPrefix = options.simulate ? 'SIMULATOR' : LOGPREFIX;
        if (!numpadController.isConnected())
            npmlog_1.default.info(this.logPrefix, this.awaitingString);
        numpadController.on('attach', () => {
            this.connectServer();
        });
        numpadController.on('remove', () => {
            if (this.socket) {
                this.socket.close();
                (0, timers_1.clearInterval)(this.serial);
                this.serialConnected = false;
            }
            npmlog_1.default.info(this.logPrefix, this.awaitingString);
        });
    } // constructor()
    //--------------------------------------------------------------------------
    // Start socket connection and controller connection.
    //--------------------------------------------------------------------------
    connectServer() {
        // We'll do this every time we connect to the server, because the sources
        // of the secret may have changed between executions.
        if (!this.options.secret)
            this.updateSecrets();
        // Set up access to the cnc.js socket server, with a valid access token.
        const token = this.generateAccessToken({ id: '', name: 'cncjs-pendant' }, this.options.secret, this.options.accessTokenLifetime);
        const server = `ws://${this.options.socketAddress}:${this.options.socketPort}`;
        // Attempt to connect to the server. By default, `io.connect` will keep
        // trying forever and ever, so we will only sit back and let it.
        npmlog_1.default.info(this.logPrefix, `Attempting connect to ${server}`);
        if (this.options.simulate) {
            this.openSerial();
        }
        else {
            this.socket = socket_io_client_1.default.connect(server, { query: `token=${token}` });
        }
        //------------------------------------------------------------------------
        // cncjs sent us a 'connect' message, saying that we are successfully
        // communicating via the socket. Cascade this success into next steps.
        //------------------------------------------------------------------------
        this.subscribeMessage('connect', () => {
            npmlog_1.default.info(this.logPrefix, `Connected to ${server}`);
            this.openSerial();
        });
        //------------------------------------------------------------------------
        // cncjs sent us an 'error' message. Not much we can do but report it and
        // kill our connection.
        //------------------------------------------------------------------------
        this.subscribeMessage('error', () => {
            npmlog_1.default.error(this.logPrefix, 'Error message received from cncjs - killing connection');
            if (this.socket)
                this.socket.close();
            npmlog_1.default.info(this.logPrefix, `Attempting reconnect to ${server}`);
            this.socket = socket_io_client_1.default.connect(server, { query: `token=${token}` });
        });
        //------------------------------------------------------------------------
        // Socket connection closed message received.
        //------------------------------------------------------------------------
        this.subscribeMessage('close', () => {
            npmlog_1.default.info(this.logPrefix, `CNCjs closed connection to ${server}.`);
            npmlog_1.default.info(this.logPrefix, `Attempting reconnect to ${server}`);
            this.socket = socket_io_client_1.default.connect(server, { query: `token=${token}` });
        });
        //------------------------------------------------------------------------
        // Our serial port open request has completed.
        //------------------------------------------------------------------------
        this.subscribeMessage('serialport:open', () => {
            (0, timers_1.clearInterval)(this.serial);
            this.serialConnected = true;
            npmlog_1.default.info(this.logPrefix, `Connection to ${this.options.port} successful.`);
        });
        //------------------------------------------------------------------------
        // The server has closed the serial port.
        //------------------------------------------------------------------------
        this.subscribeMessage('serialport:close', () => {
            this.serialConnected = false;
            npmlog_1.default.info(this.logPrefix, `Connection closed to ${this.options.port}.`);
            this.openSerial();
        });
        //------------------------------------------------------------------------
        // We got an error attempting to open the serial port
        //------------------------------------------------------------------------
        this.subscribeMessage('serialport:error', () => {
            this.serialConnected = false;
            npmlog_1.default.error(this.logPrefix, `Error opening serial port ${this.options.port}`);
            this.openSerial();
        });
        //------------------------------------------------------------------------
        // Something was read from the serial port.
        //------------------------------------------------------------------------
        this.subscribeMessage('serialport:read', (data) => {
            npmlog_1.default.trace(this.logPrefix, `Read from serial port: ${data}`);
        });
        //------------------------------------------------------------------------
        // Something was written to the serial port.
        //------------------------------------------------------------------------
        this.subscribeMessage('serialport:write', (data) => {
            npmlog_1.default.trace(this.logPrefix, `Write to serial port: ${data}`);
        });
        //------------------------------------------------------------------------
        // Gives us the controller parameters.
        // This could be used to get $130, $131, $132 which give use the maximum
        // travel distances for each axis. Except:
        //   - I can only test with grbl, so I wouldn't have these for other
        //     controllers, and
        //   - Any time you connect to the machine, the mpos is reset to {0} until
        //     after homing.
        // This would have been a nice way to implement our own soft limits for
        // the joystick. Anyway, let's keep this around for the future.
        //------------------------------------------------------------------------
        this.subscribeMessage('controller:settings', (type, settings) => {
            npmlog_1.default.trace(this.logPrefix, `controller:settings for ${type}`, settings);
        });
        //------------------------------------------------------------------------
        // Current machine status.
        // Would have been nice to know where we are before making a jog request,
        // but unless homing, we have no idea where we are. The mpos resets to
        // {0} whenever we connect to the serial port. Grbl doesn't remember.
        //------------------------------------------------------------------------
        this.subscribeMessage('controller:state', (type, state) => {
            npmlog_1.default.trace(this.logPrefix, `controller:state for ${type}`, state);
        });
        //------------------------------------------------------------------------
        // Returns the state of the current workflow.
        //   WORKFLOW_STATE_IDLE = idle
        //   WORKFLOW_STATE_PAUSED = paused
        //   WORKFLOW_STATE_RUNNING = running
        // We should ignore inputs when not idle.
        //------------------------------------------------------------------------
        this.subscribeMessage('workflow:state', (state) => {
            npmlog_1.default.trace(this.logPrefix, 'workflow:state', state);
        });
    } // connectServer()
    //--------------------------------------------------------------------------
    // Generate a token for use in connecting securely to the CNCjs socket.
    //--------------------------------------------------------------------------
    generateAccessToken(payload, secret, expiration) {
        const { sign } = jsonwebtoken_1.default;
        const token = sign(payload, secret, { expiresIn: expiration });
        return token;
    }
    //--------------------------------------------------------------------------
    // Send a message to CNCjs requesting to open the serial port.
    // `this.socket.emit()` is just a request. If the server isn't connected,
    // then we'll never connect, and there's no mechanism for the server
    // to announce to us that it is ready. Thus, just keep spamming on
    // it until someone answers.
    //--------------------------------------------------------------------------
    openSerial() {
        const msg = `Sending open request for ${this.options.port} at baud rate ${this.options.baudrate}`;
        if (this.options.simulate) {
            npmlog_1.default.info(this.logPrefix, msg);
            npmlog_1.default.info(this.logPrefix, `Connection to ${this.options.port} successful.`);
        }
        else {
            this.serial = setInterval(() => {
                npmlog_1.default.info(this.logPrefix, msg);
                this.socket.emit('open', this.options.port, {
                    baudrate: Number(this.options.baudrate),
                    controllerType: this.options.controllerType,
                });
            }, 2000);
        }
    }
    //--------------------------------------------------------------------------
    // Handle receiving messages from cncjs socket server, or faking
    // out for `--fake-socket` option.
    //--------------------------------------------------------------------------
    subscribeMessage(msg, callback) {
        if (!this.options.simulate) {
            try {
                this.socket.on(msg, callback);
            }
            catch (err) {
                npmlog_1.default.error(this.logPrefix, `Failed subscribing to message '${msg}' from the socket.`);
            }
        }
        npmlog_1.default.info(this.logPrefix, `Ready to listen for message '${msg}' from the socket.`);
    }
    //--------------------------------------------------------------------------
    // Update the stored secret if not set. This can be called each time
    // a connection is made in order to account for external changes.
    //--------------------------------------------------------------------------
    updateSecrets() {
        const userHome = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
        const cncrc = path.resolve(userHome || '', '.cncrc');
        // Check that the file exists locally
        if (!fs.existsSync(cncrc)) {
            npmlog_1.default.error(LOGPREFIX, 'Failed! No secret config file at:', cncrc);
            if (this.options.simulate) {
                npmlog_1.default.info(LOGPREFIX, 'Simulation with a secret:', 'dummySecret');
                this.options.secret = 'dummySecret';
                return;
            }
            else {
                process.exit(1);
            }
        }
        else {
            npmlog_1.default.info(LOGPREFIX, 'Success! Found secret config file at:', cncrc);
        }
        try {
            const config = JSON.parse(fs.readFileSync(cncrc, 'utf8'));
            this.options.secret = config.secret;
        }
        catch (err) {
            npmlog_1.default.error(this.logPrefix, err);
            process.exit(1);
        }
    }
} // class Connector
exports.Connector = Connector;
