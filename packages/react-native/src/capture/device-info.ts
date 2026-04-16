import { Platform, Dimensions, PixelRatio } from 'react-native'

export interface DeviceInfo {
  platform: string
  osVersion: string | number
  screenWidth: number
  screenHeight: number
  pixelRatio: number
  fontScale: number
  systemName?: string
  locale?: string
  timezone?: string
}

export function getDeviceInfo(): DeviceInfo {
  const { width, height } = Dimensions.get('window')
  return {
    platform: Platform.OS,
    osVersion: Platform.Version,
    screenWidth: width,
    screenHeight: height,
    pixelRatio: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
  }
}
