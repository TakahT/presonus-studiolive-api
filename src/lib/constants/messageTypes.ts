/* eslint no-unused-vars: "off" */

export enum MESSAGETYPES {
    KeepAlive = 'KA',
    Hello = 'UM',
    JSON = 'JM',
    Setting = 'PV',
    DeviceList = 'PL',
    FileResource = 'FR',
    FileResource2 = 'FD',

    ZLIB = 'ZB',

    Unknown1 = 'BO',

    /**
     * Compressed content
     */
    Unknown2 = 'CK',

    /**
     * Mute? mt64?
     */
    Unknown3 = 'MB',

    /**
     * Linear position of faders
     * Only message sent for main fader changes
     */
    FaderPosition = 'MS'
}
