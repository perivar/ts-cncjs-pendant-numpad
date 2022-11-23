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
const LOGPREFIX = 'NUMPAD   '; // keep at 9 digits for consistency

/*
const controllerMapping: Record<number, string> = {
  42: 'KEYCODE_BACKSPACE',
  83: 'KEYCODE_NUM_LOCK',
  84: 'KEYCODE_SLASH',
  85: 'KEYCODE_STAR',
  86: 'KEYCODE_MINUS',
  87: 'KEYCODE_PLUS',
  88: 'KEYCODE_ENTER',
  89: 'KEYCODE_NUM1',
  90: 'KEYCODE_NUM2',
  91: 'KEYCODE_NUM3',
  92: 'KEYCODE_NUM4',
  93: 'KEYCODE_NUM5',
  94: 'KEYCODE_NUM6',
  95: 'KEYCODE_NUM7',
  96: 'KEYCODE_NUM8',
  97: 'KEYCODE_NUM9',
  98: 'KEYCODE_NUM0',
  99: 'KEYCODE_DOT',
};
*/

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

export const DEFAULT_MM_PER_MIN = 2000;
export const DEFAULT_MOVE_DISTANCE = 1;

//------------------------------------------------------------------------------
// Represents the instantaneous state of the numpad.
//------------------------------------------------------------------------------
export interface NumpadState {
  moveDistance: number;
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

    const kbdevent: KeyboardEvent = {
      l_control: false,
      l_shift: false,
      l_alt: false,
      l_meta: false,
      r_control: false,
      r_shift: false,
      r_alt: false,
      r_meta: false,

      key: 0, // Normal keys
    };

    const bits = recv.shift(); // remove first element from array and returns that removed element
    kbdevent.l_control = (bits & KEY_MOD_LCTRL) !== 0;
    kbdevent.l_shift = (bits & KEY_MOD_LSHIFT) !== 0;
    kbdevent.l_alt = (bits & KEY_MOD_LALT) !== 0;
    kbdevent.l_meta = (bits & KEY_MOD_LMETA) !== 0;
    kbdevent.r_control = (bits & KEY_MOD_RCTRL) !== 0;
    kbdevent.r_shift = (bits & KEY_MOD_RSHIFT) !== 0;
    kbdevent.r_alt = (bits & KEY_MOD_RALT) !== 0;
    kbdevent.r_meta = (bits & KEY_MOD_RMETA) !== 0;

    recv.shift(); // ignore reserved byte

    kbdevent.key = recv.shift(); // remove first element from array and returns that removed element

    const keyHex = kbdevent.key.toString(16);
    log.info(LOGPREFIX, `Key: 0x${keyHex}`);

    // const buttonPress = controllerMapping[kbdevent.key];
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
