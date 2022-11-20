#!/usr/bin/env node

// actions
// A module that uses a NumPad
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.

import { EventEmitter } from 'events';
import hid from 'node-hid';
import log from 'npmlog';

import { Options } from './console';

//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'NUMPAD  '; // keep at 9 digits for consistency

//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
export interface NumpadState {
  deviceID: string;
  description: string;
  vendorID: string;
  productID: string;
  axisStates: any;
  buttonStates: any;
}

/**
 * Modifier masks - used for the first byte in the HID report.
 * NOTE: The second byte in the report is reserved, 0x00
 */

const findPath = (
  vendorId: string,
  productId: string,
  interfaceNumber: number
) => {
  if (vendorId && productId) {
    console.log('Looking for keyboard with VID:PID:', vendorId, productId);

    const devices = hid.devices();
    const deviceInfo = devices.find(item => {
      if (interfaceNumber) {
        return (
          item.vendorId === Number(vendorId) &&
          item.productId === Number(productId) &&
          item.interface === Number(interfaceNumber)
        );
      } else {
        return (
          item.vendorId === Number(vendorId) &&
          item.productId === Number(productId)
        );
      }
    });

    if (deviceInfo) {
      console.log(
        'Successfully found device with VID:PID:',
        vendorId,
        productId
      );
      return deviceInfo.path;
    } else {
      console.log('Failed finding device with VID:PID:', vendorId, productId);
      return undefined;
    }
  } else {
    return undefined;
  }
};

//------------------------------------------------------------------------------
// Instances of this class receive events and event records when numpad
// events occur. Consult the events you can subscribe to in the `on())`
// function.
//------------------------------------------------------------------------------
export class NumpadController {
  options: Options;
  mappings = [];
  connected = false;
  events = new EventEmitter.EventEmitter();

  keyboard_main: hid.HID;

  constructor(options: Options) {
    this.options = options;

    // find keyboard with index 0
    if (!this.options.simulate) {
      const keyboardHIDAddress = findPath(
        options.vendorId,
        options.productId,
        0
      );
      if (!keyboardHIDAddress) {
        log.error(LOGPREFIX, `No keyboard found! Exiting...`);
        process.exit(1);
      } else {
        log.info(LOGPREFIX, 'Keyboard HID Address:', keyboardHIDAddress);
        this.keyboard_main = new hid.HID(keyboardHIDAddress);
        this.connected = true;
      }

      // Listen for numpad events
      const kbdevent = {
        l_control: false,
        l_shift: false,
        l_alt: false,
        l_meta: false,
        r_control: false,
        r_shift: false,
        r_alt: false,
        r_meta: false,

        key: 0, // Normal keys
        move: 1, // Actually move size
        default_move: 1, // Alter by F1, F2, F3
      };

      this.keyboard_main.on('data', function (data) {
        const recv = data.toJSON().data;
        // The codes in the buffer are HID reports from a typical USB keyboard.
        // They are described in the Universal Serial Bus HID Usage Tables document in Chapter 10
        // "Keyboard/Keypad Page (0x07)".
        // The format of each report depends on the report descriptor but it is almost always:
        // 1 byte modifiers (ctrl, alt, etc),
        // 1 byte reserved,
        // 6 bytes representing up to 6 simultaneous keys being pressed.
        // A report containing all zeros means "no keys are currently being pressed".

        /**
         * Modifier masks - used for the first byte in the HID report.
         * NOTE: The second byte in the report is reserved, 0x00
         * https://gist.github.com/MightyPork/6da26e382a7ad91b5496ee55fdc73db2
         */
        const KEY_MOD_LCTRL = 0x01;
        const KEY_MOD_LSHIFT = 0x02;
        const KEY_MOD_LALT = 0x04;
        const KEY_MOD_LMETA = 0x08;
        const KEY_MOD_RCTRL = 0x10;
        const KEY_MOD_RSHIFT = 0x20;
        const KEY_MOD_RALT = 0x40;
        const KEY_MOD_RMETA = 0x80;

        const bits = recv.shift(); // remove the first element from an array and returns that removed element
        kbdevent.l_control = (bits & KEY_MOD_LCTRL) !== 0;
        kbdevent.l_shift = (bits & KEY_MOD_LSHIFT) !== 0;
        kbdevent.l_alt = (bits & KEY_MOD_LALT) !== 0;
        kbdevent.l_meta = (bits & KEY_MOD_LMETA) !== 0;
        kbdevent.r_control = (bits & KEY_MOD_RCTRL) !== 0;
        kbdevent.r_shift = (bits & KEY_MOD_RSHIFT) !== 0;
        kbdevent.r_alt = (bits & KEY_MOD_RALT) !== 0;
        kbdevent.r_meta = (bits & KEY_MOD_RMETA) !== 0;

        recv.shift(); // ignore reserved byte

        kbdevent.key = recv.shift();
        console.log('key: 0x', kbdevent.key.toString(16));

        // sendToController();
      });
    }
  }

  // subscribe to a numpad event
  on(eventName: string, handler: any) {
    switch (eventName) {
      case 'attach':
      case 'remove':
      case 'move':
      case 'press':
      case 'release':
      case 'use':
        break;
      default:
        log.error(LOGPREFIX, `NumpadController.on unknown event ${eventName}`);
        return;
    }
    this.events.on(eventName, handler);

    // if this is an attach event, and we already have a controller, let them know
    if (eventName == 'attach' && this.connected) this.events.emit('attach');
  }

  // unsubscribed from a numpad event
  off(eventName: string, handler: any) {
    this.events.off(eventName, handler);
  }

  // determine if we have a valid numpad connected
  isConnected() {
    return this.connected;
  }
}
