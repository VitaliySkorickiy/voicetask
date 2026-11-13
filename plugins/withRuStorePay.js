// RuStore Pay SDK config plugin (Expo / CNG).
// Docs: https://www.rustore.ru/help/sdk/pay/react-native
//
// Usage in app.json plugins:
//   ["./plugins/withRuStorePay.js", {
//     "consoleAppId": "123456",                    // number from RuStore Console URL apps/{ID}/versions
//     "payScheme": "ru.vitaliyskorickiy.voicetask.pay"
//   }]

const path = require('path');
const fs = require('fs');
const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withMainApplication,
  withMainActivity,
  withDangerousMod,
} = require('@expo/config-plugins');

const MAVEN_REPO = 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed';
const PAY_SDK_DEP = 'ru.rustore.sdk-wrapper.react-native:pay:11.1.0';

function withRuStorePay(config, opts = {}) {
  const consoleAppId = String(opts.consoleAppId || '').trim();
  const androidPkg = (config.android && config.android.package) || 'ru.vitaliyskorickiy.voicetask';
  const payScheme = String(opts.payScheme || `${androidPkg}.pay`).trim();

  // 1) Project build.gradle — add the RuStore maven repository.
  config = withProjectBuildGradle(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (!c.includes('nexus-external.rustore.ru')) {
      c = c.replace(
        "maven { url 'https://www.jitpack.io' }",
        "maven { url 'https://www.jitpack.io' }\n    maven { url '" + MAVEN_REPO + "' }"
      );
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  // 2) App build.gradle — add the Pay SDK dependency.
  config = withAppBuildGradle(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (!c.includes('ru.rustore.sdk-wrapper.react-native:pay')) {
      c = c.replace(
        'implementation("com.facebook.react:react-android")',
        'implementation("com.facebook.react:react-android")\n    implementation("' + PAY_SDK_DEP + '")'
      );
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  // 3) MainApplication — register the native package.
  config = withMainApplication(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (!c.includes('RuStoreReactPayPackage')) {
      c = c.replace(
        'import expo.modules.ReactNativeHostWrapper',
        'import expo.modules.ReactNativeHostWrapper\nimport ru.rustore.react.pay.RuStoreReactPayPackage'
      );
      c = c.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(RuStoreReactPayPackage())'
      );
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  // 4) MainActivity — forward the deeplink intent to the SDK.
  config = withMainActivity(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (!c.includes('RuStoreReactPayModule')) {
      c = c.replace(
        'import android.os.Build',
        'import android.content.Intent\nimport android.os.Build'
      );
      c = c.replace(
        'import expo.modules.ReactActivityDelegateWrapper',
        'import expo.modules.ReactActivityDelegateWrapper\nimport ru.rustore.react.pay.RuStoreReactPayModule'
      );
      c = c.replace(
        'super.onCreate(null)',
        'super.onCreate(null)\n    RuStoreReactPayModule.processIntent(intent)'
      );
      c = c.replace(
        '  override fun getMainComponentName(): String = "main"',
        '  override fun onNewIntent(intent: Intent) {\n    super.onNewIntent(intent)\n    RuStoreReactPayModule.processIntent(intent)\n  }\n\n  override fun getMainComponentName(): String = "main"'
      );
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  // 5) AndroidManifest.xml + strings.xml.
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const manifestPath = path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml');
      const stringsPath = path.join(root, 'app', 'src', 'main', 'res', 'values', 'strings.xml');

      let manifest = fs.readFileSync(manifestPath, 'utf8');
      let strings = fs.readFileSync(stringsPath, 'utf8');

      // strings.xml — Console application id.
      if (!strings.includes('CONSOLE_APPLICATION_ID')) {
        strings = strings.replace(
          '</resources>',
          '    <string name="CONSOLE_APPLICATION_ID">' + consoleAppId + '</string>\n</resources>'
        );
      }

      // manifest — tools namespace.
      if (!manifest.includes('xmlns:tools')) {
        manifest = manifest.replace(
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">'
        );
      }

      // manifest — meta-data + PayActivity.
      if (!manifest.includes('console_app_id_value')) {
        manifest = manifest.replace(
          '</application>',
          '    <meta-data android:name="console_app_id_value" android:value="@string/CONSOLE_APPLICATION_ID" />\n    <meta-data android:name="sdk_pay_scheme_value" android:value="' + payScheme + '" />\n    <activity android:name="ru.rustore.sdk.pay.internal.presentation.ui.PayActivity" android:exported="false" android:launchMode="singleTask" tools:replace="android:launchMode" />\n  </application>'
        );
      }

      // manifest — payment deeplink intent-filter on MainActivity.
      // (MainActivity keeps Expo's default launchMode="singleTask"; onNewIntent handles the return.)
      if (!manifest.includes('android:scheme="' + payScheme + '"')) {
        manifest = manifest.replace(
          '<action android:name="android.intent.action.MAIN"/>\n        <category android:name="android.intent.category.LAUNCHER"/>\n      </intent-filter>',
          '<action android:name="android.intent.action.MAIN"/>\n        <category android:name="android.intent.category.LAUNCHER"/>\n      </intent-filter>\n      <intent-filter>\n        <action android:name="android.intent.action.VIEW"/>\n        <category android:name="android.intent.category.DEFAULT"/>\n        <category android:name="android.intent.category.BROWSABLE"/>\n        <data android:scheme="' + payScheme + '"/>\n      </intent-filter>'
        );
      }

      fs.writeFileSync(manifestPath, manifest);
      fs.writeFileSync(stringsPath, strings);
      return cfg;
    },
  ]);

  return config;
}

module.exports = withRuStorePay;
