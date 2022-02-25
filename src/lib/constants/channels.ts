/* eslint no-unused-vars: "off" */

export enum LINE {
  LINE_1 = 1,
  LINE_2 = 2,
  LINE_3 = 3
}

export enum RETURN {
  RETURN_1 = 1,
  RETURN_2 = 2,
  RETURN_3 = 3
}

export enum FXRETURN {
  FX_1 = 1
}

export enum MAIN {
  MAIN_1 = 1
}

export enum AUX {
  AUX_1 = 1,
  AUX_2 = 2,
  AUX_3 = 3
}

export type CHANNELS = LINE | RETURN | AUX | FXRETURN | MAIN
