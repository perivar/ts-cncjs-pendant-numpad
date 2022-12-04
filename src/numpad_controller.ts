#!/usr/bin/env node

// actions
// A module that uses a NumPad
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.

import { EventEmitter } from 'events';
import hid from 'node-hid';
import log from 'npmlog';

import { Options } from './console';
import { KEY_CODE, KEY_MOD } from './keyboard-codes';

//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'NUMPAD   '; // keep at 9 digits for consistency

export interface KeyboardEvent {
  l_control: boolean;
  l_shift: boolean;
  l_alt: boolean;
  l_meta: boolean;
  r_control: boolean;
  r_shift: boolean;
  r_alt: boolean;
  r_meta: boolean;

  key: number;
}

export const findHID = (
  vendorId: string,
  productId: string,
  interfaceNumber?: number
) => {
  // return undefined if no vendorId or productId is passed
  if (!vendorId || !productId) {
    log.error(
      LOGPREFIX,
      `Missing vendor or productid. VID:PID: ${vendorId}:${productId}`
    );
    return undefined;
  }

  log.info(
    LOGPREFIX,
    `Looking for HID device with VID:PID: ${vendorId}:${productId}`
  );

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
    log.info(
      LOGPREFIX,
      `Successfully found HID device with VID:PID: ${vendorId}:${productId}`
    );
    return deviceInfo;
  } else {
    log.info(
      LOGPREFIX,
      `Failed finding HID device with VID:PID: ${vendorId}:${productId}`
    );
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
  connected = false;
  events = new EventEmitter.EventEmitter();
  keyboard: hid.HID;

  constructor(options: Options) {
    this.options = options;

    // find keyboard with index 0
    const hidDevice = findHID(options.vendorId, options.productId, 0);
    if (!hidDevice) {
      log.error(LOGPREFIX, `No keyboard found!`);
      if (!options.simulate) process.exit(1);
    } else {
      const keyboardHIDAddress = hidDevice.path;
      if (!keyboardHIDAddress) {
        log.error(LOGPREFIX, `No keyboard address found.`);
        if (!options.simulate) process.exit(1);
      } else {
        log.info(
          LOGPREFIX,
          'Opening keyboard using HID address:',
          keyboardHIDAddress
        );
        try {
          this.keyboard = new hid.HID(keyboardHIDAddress);

          // Listen for numpad data events
          this.keyboard.on('data', this.keyboardEventOn.bind(this));

          // Listen for numpad error events
          this.keyboard.on('error', err => {
            log.error(LOGPREFIX, `Keyboard unplugged? ` + err);

            // inform the listeners that we have detached the numpad
            this.connected = false;
            this.events.emit('remove');

            if (!options.simulate) process.exit(1);
          });

          // inform the listeners that we have attached the numpad
          this.connected = true;
          this.events.emit('attach');
        } catch (err) {
          log.error(LOGPREFIX, `Could not connect to keyboard.`);
          if (!options.simulate) process.exit(1);
        }
      }
    }

    if (!this.connected && options.simulate) {
      log.info(LOGPREFIX, `Simulating a connected keyboard.`);
      this.connected = true;
      this.events.emit('attach');
    }
  }

  keyboardEventOn(data: Buffer) {
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

    const kbdevent: KeyboardEvent = {
      l_control: (bits & KEY_MOD.LCTRL) !== 0 && bits <= 128,
      l_shift: (bits & KEY_MOD.LSHIFT) !== 0 && bits <= 128,
      l_alt: (bits & KEY_MOD.LALT) !== 0 && bits <= 128,
      l_meta: (bits & KEY_MOD.LMETA) !== 0 && bits <= 128,
      r_control: (bits & KEY_MOD.RCTRL) !== 0 && bits <= 128,
      r_shift: (bits & KEY_MOD.RSHIFT) !== 0 && bits <= 128,
      r_alt: (bits & KEY_MOD.RALT) !== 0 && bits <= 128,
      r_meta: (bits & KEY_MOD.RMETA) !== 0 && bits <= 128,

      key: KEY_CODE.NONE, // Normal keys
    };

    recv.shift(); // ignore reserved byte

    kbdevent.key = recv.shift(); // remove first element from array and returns that removed element

    if (kbdevent.key == 0 && bits > 128) {
      kbdevent.key = bits;
    }

    const keyCode = kbdevent.key;
    const keyHex = kbdevent.key.toString(16);
    log.info(LOGPREFIX, `Sending keyCode: 0x${keyHex} = ${keyCode}`);

    this.events.emit('use', kbdevent);
  }

  // subscribe to a numpad event
  on(eventName: string, handler: any) {
    switch (eventName) {
      case 'attach':
      case 'remove':
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
