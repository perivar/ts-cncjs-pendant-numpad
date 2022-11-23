#!/usr/bin/env node

// gcode-marlin
// G-code handler for Marlin controllers. Sends messages to CNCjs via the
// connector service based on input from the actions service.
//
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.

import { GcodeSender } from './gcode-sender';

export class GcodeMarlin extends GcodeSender {
  override performHoming() {
    this.sendMessage('command', 'gcode', 'G28 X Y');
  }

  override performZProbing() {
    this.sendMessage('command', 'gcode', 'M28 Z'); // use a simple touch plate
  }
}
