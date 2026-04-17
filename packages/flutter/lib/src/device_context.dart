import 'dart:io';
import 'dart:ui' as ui;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'config.dart';

/// Snapshots device + app context for inclusion in every report. Mirrors the
/// iOS/Android `DeviceContext` so the cross-platform schema stays identical.
class DeviceContext {
  static Future<Map<String, dynamic>> capture() async {
    final pkg = await PackageInfo.fromPlatform();
    final info = DeviceInfoPlugin();
    final view = ui.PlatformDispatcher.instance.implicitView;

    final deviceMap = <String, dynamic>{};
    if (Platform.isAndroid) {
      final a = await info.androidInfo;
      deviceMap.addAll({
        'manufacturer': a.manufacturer,
        'model': a.model,
        'osName': 'Android',
        'osVersion': a.version.release,
        'apiLevel': a.version.sdkInt,
      });
    } else if (Platform.isIOS) {
      final i = await info.iosInfo;
      deviceMap.addAll({
        'manufacturer': 'Apple',
        'model': i.utsname.machine,
        'osName': i.systemName,
        'osVersion': i.systemVersion,
      });
    } else {
      deviceMap.addAll({
        'osName': Platform.operatingSystem,
        'osVersion': Platform.operatingSystemVersion,
      });
    }
    if (view != null) {
      final size = view.physicalSize;
      deviceMap['screenWidth'] = size.width;
      deviceMap['screenHeight'] = size.height;
      deviceMap['devicePixelRatio'] = view.devicePixelRatio;
    }

    return <String, dynamic>{
      'platform': Platform.operatingSystem,
      'sdkName': MushiInfo.sdkName,
      'sdkVersion': MushiInfo.sdkVersion,
      'timestamp': DateTime.now().toUtc().millisecondsSinceEpoch,
      'locale': ui.PlatformDispatcher.instance.locale.toLanguageTag(),
      'app': {
        'id': pkg.packageName,
        'version': pkg.version,
        'build': pkg.buildNumber,
      },
      'device': deviceMap,
    };
  }
}
