#!/usr/bin/env node

// console
// A module that provides a command line interface to this package. It starts
// all services such as the connector, numpad controller, log system, etc.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.

import { Command, program } from 'commander';
import merge from 'deepmerge';
// These weird (old-fashioned?) imports are inherently singletons, and we're
// not interested in eventually testing them anyway, so let's just use them
// as singletons without any dependency injectability.
import fs from 'fs';
import log from 'npmlog';
import os from 'os';
import path from 'path';
import process from 'process';
import { URL } from 'url';

import { Actions } from './actions.js';
import { ActionsMappings } from './actions.js';
import { Connector } from './connector.js';
import { NumpadController } from './numpad_controller.js';

//----------------------------------------------------------------------------
// Constant definitions.
//----------------------------------------------------------------------------
const LOGPREFIX = 'CLI      '; // keep at 9 digits for consistency

//----------------------------------------------------------------------------
// Interface definitions.
//----------------------------------------------------------------------------

// An interface describing program options.
export interface Options {
  [key: string]: any;

  simulate: boolean;
  port: string;
  baudrate: string;
  controllerType: string;
  secret: string;
  socketAddress: string;
  socketPort: string;
  accessTokenLifetime: string;
  verbose: number;

  list: string;
  devicelist: string;
  vendorId: string;
  productId: string;
  zProbeThickness: string;
  actionsMap: ActionsMappings;
}

//----------------------------------------------------------------------------
// Execute the command line program.
//----------------------------------------------------------------------------
export function startCLI() {
  const packagejson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = packagejson.version;

  const cliOptions = configureCLI(program as Command, version)
    .parse()
    .opts();

  cliOptions['simulate'] = program.args[0] === 'simulate';
  cliOptions['actionsMap'] = {};

  const optVersion = 'options_version_2.0';
  const options: Options = mergeOptions(
    cliOptions as Options,
    getFileOptions(optVersion)
  );

  configureLogging(options);

  console.log(
    `${program.name()} is currently running. Stop running with Control-C`
  );
  console.log(
    `Use '${program.name()} --help' if you're expecting to see something else here.`
  );

  log.trace(LOGPREFIX, 'Creating the Numpad controller instance.');
  const numpadController = new NumpadController(options);

  log.trace(LOGPREFIX, 'Starting the main connector service.');
  const connector = new Connector(numpadController, options);

  log.trace(LOGPREFIX, 'Starting the actions service.');
  new Actions(connector, options);
}

//----------------------------------------------------------------------------
// configureCLI()
// Use command to set up a reasonable CLI to the services. Note that we're
// selecting 'run' or 'simulate' via an argument rather than differing
// 'commands' because there's no default command provision, and commands
// aren't able to share all of the options. This is a Commander limitation.
// TODO: re-add the 'smoothie' and 'tinyg' options. “Need help!”
//----------------------------------------------------------------------------
function configureCLI(cli: Command, version: string) {
  cli
    .version(version)
    .name('cncjs-pendant-numpad')
    .description('Use a supported numpad as a pendant to control CNCjs.')
    .usage('[options] [run|simulate]')

    .option('-p, --port <port>', 'path or name of serial port')
    .option(
      '-b, --baudrate <baudrate>',
      'baud rate (default: 115200)',
      '115200'
    )
    .option(
      '--controller-type <type>',
      'controller type: Grbl|Smoothie|TinyG (default: Grbl)',
      'Grbl'
    )
    .option(
      '-s, --secret',
      'the secret key stored in the ~/.cncjs/cncrc.cfg file'
    )
    .option(
      '--socket-address <address>',
      'socket address or hostname (default: localhost)',
      'localhost'
    )
    .option('--socket-port <port>', 'socket port (default: 8000)', '8000')
    .option(
      '--access-token-lifetime <lifetime>',
      'access token lifetime in seconds or a time span string (default: 30d)',
      '30d'
    )
    .option(
      '-v, --verbose',
      'display verbose messages; use multiple times to increase verbosity',
      function (v, a) {
        return a + 1;
      },
      0
    )

    .option('-l, --list', 'list available ports then exit')
    .option(
      '-d, --devicelist',
      'list available devices then exit (vendorId- and productId is optional)'
    )
    .option('--vendorId <vendor>', 'Vendor ID of USB HID device')
    .option('--productId <product>', 'Product ID of USB HID device')
    .option(
      '--zProbeThickness <offset>',
      'offset (thickness) for Z probe',
      '19.5'
    )

    .arguments('[action]');
  // .action(action => {
  //   console.log('action:', action);
  // })
  return cli;
}

//--------------------------------------------------------------------------
// Get a Javascript object from the given JSON file.
//--------------------------------------------------------------------------
function loadOptionsFile(filename: any, optionsVersion: string): Options {
  try {
    const rawData = fs.readFileSync(filename, 'utf8');
    const result = JSON.parse(rawData)[optionsVersion];
    return result || ({} as Options);
  } catch (err) {
    log.warn(LOGPREFIX, err as any);
    return {} as Options;
  }
}

//--------------------------------------------------------------------------
// Loads options from multiple sources (if available), and merges them
// into a single representation. Note that Windows doesn't have anything
// like /etc, and macOS should follow the the Unix convention for CLI
// applications and use ~/, *not* ~/Library/Application Support/.
//--------------------------------------------------------------------------
function getFileOptions(optionsVersion: string): Options {
  if (os.platform() == 'win32') {
    const userOpts = loadOptionsFile(
      path.resolve(os.homedir(), '.cncjs-pendant-numpad.rc.json'),
      optionsVersion
    );
    const dfltOpts = loadOptionsFile(
      // new URL('cncjs-pendant-numpad.rc.json', import.meta.url),
      new URL('cncjs-pendant-numpad.rc.json'),
      optionsVersion
    );
    const result = merge.all([dfltOpts, userOpts]);
    return result as Options;
  } else {
    const dfltOpts = loadOptionsFile(
      // new URL('cncjs-pendant-numpad.rc.json', import.meta.url),
      path.resolve('.', 'lib', 'cncjs-pendant-numpad.rc.json'),
      optionsVersion
    );
    const systOpts = loadOptionsFile(
      path.resolve('/', 'etc', 'cncjs-pendant-numpad.rc.json'),
      optionsVersion
    );
    const userOpts = loadOptionsFile(
      path.resolve(os.homedir(), '.cncjs-pendant-numpad.rc.json'),
      optionsVersion
    );
    const result = merge.all([dfltOpts, systOpts, userOpts]);
    return result as Options;
  }
}

//----------------------------------------------------------------------------
// Merge file file options into commander's options. The shallow merge
// doesn't work because we need to know whether an option from Commander
// was specified on the command line or not for it to take precedence.
//----------------------------------------------------------------------------
function mergeOptions(cliOptions: Options, fileOptions: Options): Options {
  // Determine which option value to use in the program.
  function winningValue(optionName: string): any {
    // if (program.getOptionValueSource(optionName) === 'cli') {
    //   return cliOptions[optionName];
    // }
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
function configureLogging(options: Options) {
  log.stream = process.stdout;
  log.levels = {};
  log.heading = 'CNCpad';
  log.headingStyle = { fg: 'grey' };

  log.addLevel('trace', -Infinity, { fg: 'brightCyan' }, 'trace'); // -vvv
  log.addLevel('debug', 1000, { fg: 'cyan' }, 'debug'); // -vv
  log.addLevel('info', 2000, { fg: 'green' }, ' info'); // -v
  log.addLevel('warn', 3000, { fg: 'yellow' }, ' warn');
  log.addLevel('error', 4000, { fg: 'brightRed' }, 'error');
  log.addLevel('silent', Infinity);

  switch (options.verbose) {
    case 0:
      log.level = 'warn';
      break;
    case 1:
      log.level = 'info';
      break;
    case 2:
      log.level = 'debug';
      break;
    default:
      log.level = 'trace';
  }
}

//----------------------------------------------------------------------------
// demoLogging()
// A simple demonstration of what can/will be output from the logging system.
//----------------------------------------------------------------------------
function demoLogging() {
  log.trace('DRIVER   ', 'registers: pc=0402 sr=30 ac=00 xr=0 yr=0 sp=f7');
  log.debug('DRIVER   ', 'KEYCODE_BUTTON_L1: true');
  log.info('', 'Waiting for a numpad to be connected.');
  log.warn('FRONTEND ', 'Password is weak.');
  log.error('CONNECTOR', 'Short circuit detected in operator.');
  log.silent('', 'You should never see this.');
}
