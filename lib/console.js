#!/usr/bin/env node
"use strict";
// console
// A module that provides a command line interface to this package. It starts
// all services such as the connector, numpad controller, log system, etc.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCLI = void 0;
const commander_1 = require("commander");
const deepmerge_1 = __importDefault(require("deepmerge"));
const fs_1 = __importDefault(require("fs"));
const node_hid_1 = __importDefault(require("node-hid"));
const npmlog_1 = __importDefault(require("npmlog"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const process_1 = __importDefault(require("process"));
const serialport_1 = __importDefault(require("serialport"));
const url_1 = require("url");
const actions_1 = require("./actions");
const connector_1 = require("./connector");
const numpad_controller_1 = require("./numpad_controller");
//----------------------------------------------------------------------------
// Constant definitions.
//----------------------------------------------------------------------------
const LOGPREFIX = 'CLI      '; // keep at 9 digits for consistency
const decimalToHex = (d) => '0x' + Number(d).toString(16).padStart(4, '0');
const logDevice = (hidDevice) => {
    console.info(`Manufacturer: ${hidDevice.manufacturer}`);
    console.info(`VendorId: ${decimalToHex(hidDevice.vendorId)} (${hidDevice.vendorId})`);
    console.info(`ProductId: ${decimalToHex(hidDevice.productId)} (${hidDevice.productId})`);
    console.info(LOGPREFIX, `Interface: ${hidDevice.interface}`);
    console.info(LOGPREFIX, `Path: ${hidDevice.path}`);
};
//----------------------------------------------------------------------------
// Execute the command line program.
//----------------------------------------------------------------------------
function startCLI() {
    const packagejson = JSON.parse(fs_1.default.readFileSync('package.json', 'utf8'));
    const version = packagejson.version;
    const cliOptions = configureCLI(commander_1.program, version)
        .parse()
        .opts();
    if (cliOptions.list) {
        console.info(`Starting to look for serial ports...`);
        serialport_1.default
            .list()
            .then(ports => {
            console.info(`Found serial ports:`);
            ports.forEach(port => {
                console.info(`${port.path}`);
            });
        })
            .catch(err => {
            console.error(LOGPREFIX, err);
        });
        return;
    }
    if (cliOptions.deviceList) {
        console.info(`Looking for USB devices:`);
        if (cliOptions.vendorId && cliOptions.productId) {
            const hidDevice = (0, numpad_controller_1.findHID)(cliOptions.vendorId, cliOptions.productId);
            if (hidDevice) {
                logDevice(hidDevice);
            }
        }
        else {
            const devices = node_hid_1.default.devices();
            devices.forEach(hidDevice => {
                logDevice(hidDevice);
                console.info(`----------------------`);
            });
        }
        return;
    }
    // read default arguments (cannot be read before --deviceList) from config file
    const optVersion = 'options_version_2.0';
    const options = mergeOptions(cliOptions, getFileOptions(optVersion));
    configureLogging(options);
    if (!options.port) {
        if (options.simulate) {
            npmlog_1.default.warn(LOGPREFIX, `Simulating with dummy port: /dummy/port`);
            options.port = '/dummy/port';
        }
        else {
            npmlog_1.default.error(LOGPREFIX, `No port specified!`);
            serialport_1.default
                .list()
                .then(ports => {
                npmlog_1.default.error(LOGPREFIX, `Please specify one of these using --port`);
                ports.forEach(port => {
                    npmlog_1.default.error(LOGPREFIX, `${port.path}`);
                });
            })
                .catch(err => {
                npmlog_1.default.error(LOGPREFIX, err);
            });
            return;
        }
    }
    logAllOptions(options);
    console.log(`${commander_1.program.name()} is currently running. Stop running with Control-C`);
    console.log(`Use '${commander_1.program.name()} --help' if you're expecting to see something else here.`);
    npmlog_1.default.trace(LOGPREFIX, 'Creating the Numpad instance.');
    const numpadController = new numpad_controller_1.NumpadController(options);
    npmlog_1.default.trace(LOGPREFIX, 'Starting the main connector service.');
    const connector = new connector_1.Connector(numpadController, options);
    npmlog_1.default.trace(LOGPREFIX, 'Starting the actions service.');
    new actions_1.Actions(connector, options);
}
exports.startCLI = startCLI;
//----------------------------------------------------------------------------
// configureCLI()
// Use command to set up a reasonable CLI to the services. Note that we're
// selecting 'run' or 'simulate' via an argument rather than differing
// 'commands' because there's no default command provision, and commands
// aren't able to share all of the options. This is a Commander limitation.
// TODO: re-add the 'smoothie' and 'tinyg' options. “Need help!”
//----------------------------------------------------------------------------
function configureCLI(cli, version) {
    cli
        .version(version)
        .name('cncjs-pendant-numpad')
        .description('Use a supported numpad as a pendant to control CNCjs.')
        .usage('[options] [run|simulate]')
        .option('-p, --port <port>', 'path or name of serial port')
        .option('-b, --baudrate <baudrate>', 'baud rate (default: 115200)')
        .option('--controller-type <type>', 'controller type: Grbl|Smoothie|TinyG (default: Grbl)')
        .option('-s, --secret', 'the secret key stored in the ~/.cncjs/cncrc.cfg file')
        .option('--socket-address <address>', 'socket address or hostname (default: localhost)')
        .option('--socket-port <port>', 'socket port (default: 8000)')
        .option('--access-token-lifetime <lifetime>', 'access token lifetime in seconds or a time span string (default: 30d)')
        .option('-v, --verbose', 'display verbose messages; use multiple times to increase verbosity', function (v, a) {
        return a + 1;
    }, 0)
        .option('-l, --list', 'list available ports then exit')
        .option('-d, --deviceList', 'list available devices then exit (vendorId- and productId is optional)')
        .option('--vendorId <vendor>', 'Vendor ID of USB HID device')
        .option('--productId <product>', 'Product ID of USB HID device')
        .option('--zProbeThickness <offset>', 'offset (thickness) for Z probe')
        .option('--defaultFeedrate <feedrate>', 'default feedrate for movements');
    return cli;
}
//--------------------------------------------------------------------------
// Get a Javascript object from the given JSON file.
//--------------------------------------------------------------------------
function loadOptionsFile(filename, optionsVersion) {
    try {
        const rawData = fs_1.default.readFileSync(filename, 'utf8');
        const result = JSON.parse(rawData)[optionsVersion];
        return result || {};
    }
    catch (err) {
        // log.warn(LOGPREFIX, err as any);
        return {};
    }
}
//--------------------------------------------------------------------------
// Loads options from multiple sources (if available), and merges them
// into a single representation. Note that Windows doesn't have anything
// like /etc, and macOS should follow the the Unix convention for CLI
// applications and use ~/, *not* ~/Library/Application Support/.
//--------------------------------------------------------------------------
function getFileOptions(optionsVersion) {
    if (os_1.default.platform() == 'win32') {
        const userOpts = loadOptionsFile(path_1.default.resolve(os_1.default.homedir(), '.cncjs-pendant-numpad.rc.json'), optionsVersion);
        const dfltOpts = loadOptionsFile(
        // new URL('cncjs-pendant-numpad.rc.json', import.meta.url),
        new url_1.URL('cncjs-pendant-numpad.rc.json'), optionsVersion);
        const result = deepmerge_1.default.all([dfltOpts, userOpts]);
        return result;
    }
    else {
        const dfltOpts = loadOptionsFile(
        // new URL('cncjs-pendant-numpad.rc.json', import.meta.url),
        path_1.default.resolve('.', 'lib', 'cncjs-pendant-numpad.rc.json'), optionsVersion);
        const systOpts = loadOptionsFile(path_1.default.resolve('/', 'etc', 'cncjs-pendant-numpad.rc.json'), optionsVersion);
        const userOpts = loadOptionsFile(path_1.default.resolve(os_1.default.homedir(), '.cncjs-pendant-numpad.rc.json'), optionsVersion);
        const result = deepmerge_1.default.all([dfltOpts, systOpts, userOpts]);
        return result;
    }
}
//----------------------------------------------------------------------------
// Merge file file options into commander's options. The shallow merge
// doesn't work because we need to know whether an option from Commander
// was specified on the command line or not for it to take precedence.
//----------------------------------------------------------------------------
function mergeOptions(cliOptions, fileOptions) {
    // Determine which option value to use in the program.
    function winningValue(optionName) {
        return cliOptions[optionName] || fileOptions[optionName];
    }
    // console.log('Options passed to CLI:', cliOptions);
    const result = {
        // withouth default values
        port: winningValue('port'),
        list: winningValue('list'),
        deviceList: winningValue('deviceList'),
        vendorId: winningValue('vendorId'),
        productId: winningValue('productId'),
        // with default values
        simulate: commander_1.program.args[0] === 'simulate',
        secret: winningValue('secret') || process_1.default.env['CNCJS_SECRET'],
        verbose: winningValue('verbose') || 0,
        baudrate: winningValue('baudrate') || 115200,
        controllerType: winningValue('controllerType') || 'Grbl',
        socketAddress: winningValue('socketAddress') || 'localhost',
        socketPort: winningValue('socketPort') || 8000,
        accessTokenLifetime: winningValue('accessTokenLifetime') || '30d',
        zProbeThickness: winningValue('zProbeThickness') || '19.5',
        defaultFeedrate: winningValue('defaultFeedrate') || '2000',
        actionsMap: fileOptions['actionsMap'] || {},
    };
    return result;
}
function logAllOptions(options) {
    npmlog_1.default.info(LOGPREFIX, `Port:`, options.port);
    npmlog_1.default.info(LOGPREFIX, `List:`, options.list);
    npmlog_1.default.info(LOGPREFIX, `Device list:`, options.deviceList);
    npmlog_1.default.info(LOGPREFIX, `Vendor id:`, options.vendorId);
    npmlog_1.default.info(LOGPREFIX, `Product id:`, options.productId);
    npmlog_1.default.info(LOGPREFIX, `Simulate:`, options.simulate);
    npmlog_1.default.info(LOGPREFIX, `Secret:`, options.secret);
    npmlog_1.default.info(LOGPREFIX, `Verbose:`, options.verbose);
    npmlog_1.default.info(LOGPREFIX, `Baudrate:`, options.baudrate);
    npmlog_1.default.info(LOGPREFIX, `Controller type:`, options.controllerType);
    npmlog_1.default.info(LOGPREFIX, `Socket address:`, options.socketAddress);
    npmlog_1.default.info(LOGPREFIX, `Socket port:`, options.socketPort);
    npmlog_1.default.info(LOGPREFIX, `Access token lifetime:`, options.accessTokenLifetime);
    npmlog_1.default.info(LOGPREFIX, `Z probe thickness:`, options.zProbeThickness);
    npmlog_1.default.info(LOGPREFIX, `Default feedrate:`, options.defaultFeedrate);
    npmlog_1.default.info(LOGPREFIX, `Actions map:`, options.actionsMap);
}
//----------------------------------------------------------------------------
// configureLogging()
//----------------------------------------------------------------------------
function configureLogging(options) {
    npmlog_1.default.stream = process_1.default.stdout;
    npmlog_1.default.levels = {};
    npmlog_1.default.heading = 'CNCpad';
    npmlog_1.default.headingStyle = { fg: 'grey' };
    npmlog_1.default.addLevel('trace', -Infinity, { fg: 'brightCyan' }, 'trace'); // -vvv
    npmlog_1.default.addLevel('debug', 1000, { fg: 'cyan' }, 'debug'); // -vv
    npmlog_1.default.addLevel('info', 2000, { fg: 'green' }, ' info'); // -v
    npmlog_1.default.addLevel('warn', 3000, { fg: 'yellow' }, ' warn');
    npmlog_1.default.addLevel('error', 4000, { fg: 'brightRed' }, 'error');
    npmlog_1.default.addLevel('silent', Infinity);
    switch (options.verbose) {
        case 0:
            npmlog_1.default.level = 'warn';
            break;
        case 1:
            npmlog_1.default.level = 'info';
            break;
        case 2:
            npmlog_1.default.level = 'debug';
            break;
        default:
            npmlog_1.default.level = 'trace';
    }
}
//----------------------------------------------------------------------------
// demoLogging()
// A simple demonstration of what can/will be output from the logging system.
//----------------------------------------------------------------------------
// function demoLogging() {
//   log.trace('DRIVER   ', 'registers: pc=0402 sr=30 ac=00 xr=0 yr=0 sp=f7');
//   log.debug('DRIVER   ', 'KEYCODE_BUTTON_L1: true');
//   log.info('', 'Waiting for a numpad to be connected.');
//   log.warn('FRONTEND ', 'Password is weak.');
//   log.error('CONNECTOR', 'Short circuit detected in operator.');
//   log.silent('', 'You should never see this.');
// }
