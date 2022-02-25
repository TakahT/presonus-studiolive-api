/* eslint no-unused-vars: "off" */

/* Channel actions */
export enum CHACTIONS {
    AUTOGAIN = 'autogain',
    GAIN = 'preampgain',
    REVLEV = 'FXA',
    PAN = 'pan',
    VOLUME = 'volume',
    MUTE = 'mute',
    SOLO = 'solo',
    ASSIGN = 'assign',
    NAME = 'username'
}

/* Fat Channel actions */
export enum FCACTIONS {

  HPON = 'filter/hpf',
  GATEON = 'gate/on',
  COMPON = 'comp/on',
  EQON = 'eq/eqallon',
  LIMON = 'limit/limiteron',
  FXON = 'voicefx/on',
  SWAP = 'swapcompeq',
  EQMODE = 'eqmode',
  COMPMODE = 'compmode',
  MUTE = 'MUTE'
}
