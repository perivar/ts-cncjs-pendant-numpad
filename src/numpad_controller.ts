#!/usr/bin/env node

// actions
// A module that uses a NumPad
// Copyright (c) 2017-2022 various contributors. See LICENSE for copyright
// and MIT license information.

import { EventEmitter } from 'events';
import hid from 'node-hid';
import log from 'npmlog';
import serialport from 'serialport';

import { Options } from './console';

//------------------------------------------------------------------------------
// Constant and interface definitions.
//------------------------------------------------------------------------------
const LOGPREFIX = 'NUMPAD  '; // keep at 9 digits for consistency

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
  move: number;
  default_move: number;
}

const findPath = (
  vendorId: string,
  productId: string,
  interfaceNumber?: number
) => {
  if (vendorId && productId) {
    log.info(
      LOGPREFIX,
      `Looking for keyboard with VID:PID: ${vendorId}:${productId}`
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
        `Successfully found device with VID:PID: ${vendorId}:${productId}`
      );
      return deviceInfo.path;
    } else {
      log.info(
        LOGPREFIX,
        `Failed finding device with VID:PID: ${vendorId}:${productId}`
      );
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
  connected = false;
  events = new EventEmitter.EventEmitter();
  keyboard: hid.HID;

  constructor(options: Options) {
    this.options = options;

    if (options.list) {
      log.info(LOGPREFIX, `Serialports found:`);
      serialport
        .list()
        .then(ports => {
          ports.forEach(port => {
            log.info(LOGPREFIX, `${port.path}`);
          });
        })
        .catch(err => {
          if (err) {
            log.error(LOGPREFIX, err);
          }
        });

      process.exit(1);
    }

    if (options.devicelist) {
      log.info(LOGPREFIX, `USB devices found:`);
      if (options.vendorId && options.productId) {
        log.info(
          LOGPREFIX,
          `Keyboard HID Address: ${findPath(
            options.vendorId,
            options.productId
          )}`
        );
      } else {
        const devices = hid.devices();
        devices.forEach(device => {
          log.info(LOGPREFIX, `Manufacturer: ${device.manufacturer}`);
          log.info(LOGPREFIX, `VendorId: ${device.vendorId}`);
          log.info(LOGPREFIX, `ProductId: ${device.productId}`);
          log.info(LOGPREFIX, `Interface: ${device.interface}`);
          log.info(LOGPREFIX, `Path: ${device.path}\n`);
        });
      }

      process.exit(1);
    }

    // find keyboard with index 0
    const keyboardHIDAddress = findPath(options.vendorId, options.productId, 0);
    if (!keyboardHIDAddress) {
      log.error(LOGPREFIX, `No keyboard found! Exiting...`);
      process.exit(1);
    } else {
      log.info(LOGPREFIX, 'Keyboard HID Address:', keyboardHIDAddress);
      this.keyboard = new hid.HID(keyboardHIDAddress);
      this.connected = true;

      // Listen for numpad events
      this.keyboard.on('data', this.keyboardEventOn.bind(this));
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
      move: 1, // Actually move size
      default_move: 1, // Alter by F1, F2, F3
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
    this.events.emit('press', kbdevent);
    this.events.emit('use', kbdevent);
  }

  // subscribe to a numpad event
  on(eventName: string, handler: any) {
    switch (eventName) {
      case 'press':
      case 'use':
        break;
      default:
        log.error(LOGPREFIX, `NumpadController.on unknown event ${eventName}`);
        return;
    }
    this.events.on(eventName, handler);
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
