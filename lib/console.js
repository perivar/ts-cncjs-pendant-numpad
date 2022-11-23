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
const actions_js_1 = require("./actions.js");
const connector_js_1 = require("./connector.js");
const numpad_controller_js_1 = require("./numpad_controller.js");
//----------------------------------------------------------------------------
// Constant definitions.
//----------------------------------------------------------------------------
const LOGPREFIX = 'CLI      '; // keep at 9 digits for consistency
const decimalToHex = (d) => '0x' + Number(d).toString(16).padStart(4, '0');
//----------------------------------------------------------------------------
// Execute the command line program.
//----------------------------------------------------------------------------
function startCLI() {
    const packagejson = JSON.parse(fs_1.default.readFileSync('package.json', 'utf8'));
    const version = packagejson.version;
    const cliOptions = configureCLI(commander_1.program, version)
        .parse()
        .opts();
    cliOptions['simulate'] = commander_1.program.args[0] === 'simulate';
    cliOptions['actionsMap'] = {};
    configureLogging(cliOptions);
    if (cliOptions.list) {
        npmlog_1.default.info(LOGPREFIX, `Starting to look for serial ports...`);
        serialport_1.default
            .list()
            .then(ports => {
            npmlog_1.default.info(LOGPREFIX, `Found serial ports:`);
            ports.forEach(port => {
                npmlog_1.default.info(LOGPREFIX, `${port.path}`);
            });
        })
            .catch(err => {
            npmlog_1.default.error(LOGPREFIX, err);
        });
        return;
    }
    if (cliOptions.devicelist) {
        npmlog_1.default.info(LOGPREFIX, `Looking for USB devices:`);
        if (cliOptions.vendorId && cliOptions.productId) {
            const hidDevice = (0, numpad_controller_js_1.findHID)(cliOptions.vendorId, cliOptions.productId);
            if (hidDevice) {
                npmlog_1.default.info(LOGPREFIX, `Manufacturer: ${hidDevice.manufacturer}`);
                npmlog_1.default.info(LOGPREFIX, `VendorId: ${decimalToHex(hidDevice.vendorId)}`);
                npmlog_1.default.info(LOGPREFIX, `ProductId: ${decimalToHex(hidDevice.productId)}`);
                npmlog_1.default.info(LOGPREFIX, `Interface: ${hidDevice.interface}`);
                npmlog_1.default.info(LOGPREFIX, `Path: ${hidDevice.path}`);
            }
        }
        else {
            const devices = node_hid_1.default.devices();
            devices.forEach(hidDevice => {
                npmlog_1.default.info(LOGPREFIX, `Manufacturer: ${hidDevice.manufacturer}`);
                npmlog_1.default.info(LOGPREFIX, `VendorId: ${decimalToHex(hidDevice.vendorId)}`);
                npmlog_1.default.info(LOGPREFIX, `ProductId: ${decimalToHex(hidDevice.productId)}`);
                npmlog_1.default.info(LOGPREFIX, `Interface: ${hidDevice.interface}`);
                npmlog_1.default.info(LOGPREFIX, `Path: ${hidDevice.path}\n`);
            });
        }
        return;
    }
    // read default vendor and product id (cannot be read before --devicelist) from config file
    const optVersion = 'options_version_2.0';
    const options = mergeOptions(cliOptions, getFileOptions(optVersion));
    if (!options.secret && process_1.default.env['CNCJS_SECRET']) {
        options.secret = process_1.default.env['CNCJS_SECRET'];
    }
    if (!options.port) {
        npmlog_1.default.error(LOGPREFIX, `No port specified!`);
        return;
    }
    console.log(`${commander_1.program.name()} is currently running. Stop running with Control-C`);
    console.log(`Use '${commander_1.program.name()} --help' if you're expecting to see something else here.`);
    npmlog_1.default.trace(LOGPREFIX, 'Creating the Numpad instance.');
    const numpadController = new numpad_controller_js_1.NumpadController(options);
    npmlog_1.default.trace(LOGPREFIX, 'Starting the main connector service.');
    const connector = new connector_js_1.Connector(numpadController, options);
    npmlog_1.default.trace(LOGPREFIX, 'Starting the actions service.');
    new actions_js_1.Actions(connector, options);
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
        .option('-b, --baudrate <baudrate>', 'baud rate (default: 115200)', '115200')
        .option('--controller-type <type>', 'controller type: Grbl|Smoothie|TinyG (default: Grbl)', 'Grbl')
        .option('-s, --secret', 'the secret key stored in the ~/.cncjs/cncrc.cfg file')
        .option('--socket-address <address>', 'socket address or hostname (default: localhost)', 'localhost')
        .option('--socket-port <port>', 'socket port (default: 8000)', '8000')
        .option('--access-token-lifetime <lifetime>', 'access token lifetime in seconds or a time span string (default: 30d)', '30d')
        .option('-v, --verbose', 'display verbose messages; use multiple times to increase verbosity', function (v, a) {
        return a + 1;
    }, 0)
        .option('-l, --list', 'list available ports then exit')
        .option('-d, --devicelist', 'list available devices then exit (vendorId- and productId is optional)')
        .option('--vendorId <vendor>', 'Vendor ID of USB HID device')
        .option('--productId <product>', 'Product ID of USB HID device')
        .option('--zProbeThickness <offset>', 'offset (thickness) for Z probe', '19.5')
        .arguments('[action]');
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
        if (cliOptions[optionName]) {
            return cliOptions[optionName];
        }
        return fileOptions[optionName] || cliOptions[optionName];
    }
    const result = {
        simulate: winningValue('simulate'),
        port: winningValue('port'),
        baudrate: winningValue('baudrate'),
        controllerType: winningValue('controllerType'),
        secret: winningValue('secret'),
        socketAddress: winningValue('socketAddress'),
        socketPort: winningValue('socketPort'),
        accessTokenLifetime: winningValue('accessTokenLifetime'),
        verbose: winningValue('verbose'),
        list: winningValue('list'),
        devicelist: winningValue('devicelist'),
        vendorId: winningValue('vendorId'),
        productId: winningValue('productId'),
        zProbeThickness: winningValue('zProbeThickness'),
        actionsMap: fileOptions['actionsMap'],
    };
    return result;
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
function demoLogging() {
    npmlog_1.default.trace('DRIVER   ', 'registers: pc=0402 sr=30 ac=00 xr=0 yr=0 sp=f7');
    npmlog_1.default.debug('DRIVER   ', 'KEYCODE_BUTTON_L1: true');
    npmlog_1.default.info('', 'Waiting for a numpad to be connected.');
    npmlog_1.default.warn('FRONTEND ', 'Password is weak.');
    npmlog_1.default.error('CONNECTOR', 'Short circuit detected in operator.');
    npmlog_1.default.silent('', 'You should never see this.');
}
