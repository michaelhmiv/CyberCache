# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Preserve Capacitor bridge, plugins, and WebView JS interfaces under R8
-keep class com.getcapacitor.** { *; }
-keep class com.michaelhmiv.cybercache.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve AdMob & Social Login plugin classes
-keep class com.getcapacitor.community.admob.** { *; }
-keep class ee.forgr.capacitor.social.** { *; }
-keep class com.google.android.gms.ads.** { *; }

# Keep stack trace line numbers for crash reporting
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
