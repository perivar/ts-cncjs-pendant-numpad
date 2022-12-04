/**
 * Modifier masks - used for the first byte in the HID report.
 * NOTE: The second byte in the report is reserved, 0x00
 * https://gist.github.com/MightyPork/6da26e382a7ad91b5496ee55fdc73db2
 */
export enum KEY_MOD {
  LCTRL = 0x01,
  LSHIFT = 0x02,
  LALT = 0x04,
  LMETA = 0x08,
  RCTRL = 0x10,
  RSHIFT = 0x20,
  RALT = 0x40,
  RMETA = 0x80,
}

/**
 * Scan codes - last N slots in the HID report (usually 6).
 * 0x00 if no key pressed.
 *
 * If more than N keys are pressed, the HID reports
 * KEY_ERR_OVF in all slots to indicate this condition.
 * https://gist.github.com/MightyPork/6da26e382a7ad91b5496ee55fdc73db2
 * https://gist.github.com/Crenshinibon/5238119
 * https://git.sr.ht/~sircmpwn/hare-sdl2/tree/7855e717d6af1b4f1e9ed15b7db9bda6686da954/item/sdl2/keyboard.ha
 */
export enum KEY_CODE {
  NONE = 0x00, // No key pressed

  ENTER = 0x28, // Keyboard Return (ENTER) = 40
  ESC = 0x29, // Keyboard ESCAPE = 41
  BACKSPACE = 0x2a, // Keyboard DELETE (Backspace) = 42
  TAB = 0x2b, // Keyboard Tab = 43
  SPACE = 0x2c, // Keyboard Spacebar = 44

  NUMLOCK = 0x53, // Keyboard Num Lock and Clear = 83
  KPSLASH = 0x54, // Keypad / = 84
  KPASTERISK = 0x55, // Keypad * = 85
  KPMINUS = 0x56, // Keypad - = 86
  KPPLUS = 0x57, // Keypad + = 87
  KPENTER = 0x58, // Keypad ENTER = 88
  KP1 = 0x59, // Keypad 1 and End = 89
  KP2 = 0x5a, // Keypad 2 and Down Arrow = 90
  KP3 = 0x5b, // Keypad 3 and PageDn = 91
  KP4 = 0x5c, // Keypad 4 and Left Arrow = 92
  KP5 = 0x5d, // Keypad 5 = 93
  KP6 = 0x5e, // Keypad 6 and Right Arrow = 94
  KP7 = 0x5f, // Keypad 7 and Home = 95
  KP8 = 0x60, // Keypad 8 and Up Arrow = 96
  KP9 = 0x61, // Keypad 9 and Page Up = 97
  KP0 = 0x62, // Keypad 0 and Insert = 98
  KPDOT = 0x63, // Keypad . and Delete = 99
}
