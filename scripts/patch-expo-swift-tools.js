const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

/**
 * Which Swift is on THIS machine, and does it need the downgrade?
 *
 * Expo SDK 56 ships Package.swift files declaring swift-tools-version 6.2.
 * The Office Mac has Xcode 16.4 / Swift 6.1, which rejects that outright, so
 * these patches rewrite 6.2 down to 6.1 and work around the C++ interop that
 * only Swift 6.2 understands.
 *
 * On a machine that HAS Swift 6.2 — a GitHub macOS runner carries Xcode 26 —
 * applying the same patches is not a fix, it is damage: it rewrites correct
 * sources into the shape an older compiler needed. Asking the compiler its
 * version costs one call and lets the same repo build in both places.
 */
function swiftMajorMinor() {
  try {
    const out = execFileSync("swift", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/Swift version (\d+)\.(\d+)/);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]) };
  } catch {
    // No Swift at all (Linux, a bare container). Nothing here applies.
    return null;
  }
}

const swift = swiftMajorMinor();
const needsDowngrade = swift !== null && (swift.major < 6 || (swift.major === 6 && swift.minor < 2));

if (swift === null) {
  console.log("No Swift toolchain found; skipping the Apple patches.");
} else if (!needsDowngrade) {
  console.log(
    `Swift ${swift.major}.${swift.minor} understands Expo SDK 56 as shipped; ` +
      "skipping the Swift 6.1 downgrade patches."
  );
}
const packageFiles = [
  "node_modules/expo-modules-jsi/apple/Package.swift",
  "node_modules/@expo/expo-modules-macros-plugin/apple/Package.swift",
];

const reactNativeGradleSettings = path.join(
  root,
  "node_modules/@react-native/gradle-plugin/settings.gradle.kts"
);

if (fs.existsSync(reactNativeGradleSettings)) {
  const source = fs.readFileSync(reactNativeGradleSettings, "utf8");
  const patched = source.replace(
    'id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")',
    'id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")'
  );

  if (patched !== source) {
    fs.writeFileSync(reactNativeGradleSettings, patched);
    console.log("Patched React Native Gradle Foojay resolver for Gradle 9.");
  }
}

for (const relativeFile of needsDowngrade ? packageFiles : []) {
  const file = path.join(root, relativeFile);

  if (!fs.existsSync(file)) {
    continue;
  }

  const source = fs.readFileSync(file, "utf8");
  const patched = source.replace(
    "// swift-tools-version: 6.2",
    "// swift-tools-version: 6.1"
  );

  if (patched !== source) {
    fs.writeFileSync(file, patched);
    console.log(`Patched ${relativeFile} for Xcode Swift 6.1.`);
  }
}

const expoModulesJsiSources = path.join(
  root,
  "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI"
);

function walkSwiftFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkSwiftFiles(entryPath);
    }
    return entry.name.endsWith(".swift") ? [entryPath] : [];
  });
}

for (const file of needsDowngrade ? walkSwiftFiles(expoModulesJsiSources) : []) {
  const source = fs.readFileSync(file, "utf8");
  const patched = source
    .replace(/\bweak let\b/g, "weak var")
    .replace(
      "internal final class HostFunctionContext: Sendable",
      "internal final class HostFunctionContext: @unchecked Sendable"
    )
    .replace(
      "internal final class HostObjectContext: Sendable",
      "internal final class HostObjectContext: @unchecked Sendable"
    )
    .replace(
      "public final class JavaScriptPropNameID: JavaScriptType {",
      "public final class JavaScriptPropNameID: JavaScriptType, @unchecked Sendable {"
    )
    .replace(
      "public final class JavaScriptValue: JavaScriptType, Equatable, Escapable, Error {",
      "public final class JavaScriptValue: JavaScriptType, Equatable, Escapable, Error, @unchecked Sendable {"
    )
    .replace(/, @unchecked Sendable, @unchecked Sendable/g, ", @unchecked Sendable")
    .replace(
      "return Task.immediate(name: name, priority: priority, operation: operation)",
      "return Task(priority: priority ?? .high, operation: operation)"
    )
    .replace(
      /    if #available\(macOS 26\.0, iOS 26\.0, watchOS 26\.0, tvOS 26\.0, \*\) \{\n      return Task\(priority: priority \?\? \.high, operation: operation\)\n    \} else \{\n      \/\/ In the polyfill always use the highest priority and hope it executes earlier\.\n      return Task\(name: name, priority: \.high, operation: operation\)\n    \}/,
      "    // Xcode Swift 6.1 does not include `Task.immediate` or the `Task(name:)`\n    // initializer, so always use the delayed polyfill path.\n    return Task(priority: priority ?? .high, operation: operation)"
    )
    .replace(
      "return Task(name: name, priority: .high, operation: operation)",
      "return Task(priority: priority ?? .high, operation: operation)"
    )
    .replace(/expo\.RuntimeScheduler\(\)/g, "expo.makeRuntimeScheduler()")
    .replace(
      "expo.RuntimeScheduler(scheduler, fn)",
      "expo.makeRuntimeScheduler(scheduler, fn)"
    )
    .replace(
      "expo.NativeState(ptr, deallocate)",
      "expo.makeNativeState(ptr, deallocate)"
    )
    .replace(
      "expo.HostFunctionClosure(context, call, deallocate)",
      "expo.makeHostFunctionClosure(context, call, deallocate)"
    )
    .replace(
      /vector\.push_back\(consuming: propNameId\)/g,
      "expo.movePushBackPropNameID(&vector, propNameId)"
    )
    .replace(
      "_ arguments: consuming JavaScriptValuesBuffer,\n    ) async throws -> JavaScriptValue",
      "_ arguments: consuming JavaScriptValuesBuffer\n    ) async throws -> JavaScriptValue"
    );

  if (patched !== source) {
    fs.writeFileSync(file, patched);
    console.log(`Patched ${path.relative(root, file)} for Xcode Swift 6.1.`);
  }
}

const cxxPatches = [
  {
    file: "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/JSIUtils.h",
    marker: "inline void movePushBackPropNameID",
    find: "} // namespace expo\n\n#pragma clang assume_nonnull end",
    replacement: `/**\n * Moves a PropNameID into a vector – works around Swift 6.1 C++ interop\n * not being able to select the push_back(T&&) overload for move-only types.\n */\ninline void movePushBackPropNameID(std::vector<jsi::PropNameID> *vec, jsi::PropNameID id) {\n  vec->push_back(std::move(id));\n}\n\n} // namespace expo\n\n#pragma clang assume_nonnull end`,
  },
  {
    file: "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h",
    marker: "inline RuntimeScheduler *makeRuntimeScheduler()",
    find: "} SWIFT_SHARED_REFERENCE(retainRuntimeScheduler, releaseRuntimeScheduler);\n\n} // namespace expo",
    replacement: `} SWIFT_SHARED_REFERENCE(retainRuntimeScheduler, releaseRuntimeScheduler);

inline RuntimeScheduler *makeRuntimeScheduler() {
  return new RuntimeScheduler();
}

inline RuntimeScheduler *makeRuntimeScheduler(void *scheduler, RuntimeScheduler::ScheduleFn fn) {
  return new RuntimeScheduler(scheduler, fn);
}

} // namespace expo`,
  },
  {
    file: "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/HostFunctionClosure.h",
    marker: "inline HostFunctionClosure *makeHostFunctionClosure",
    find: "} SWIFT_IMMORTAL_REFERENCE; // class HostFunctionClosure\n\n} // namespace expo",
    replacement: `} SWIFT_IMMORTAL_REFERENCE; // class HostFunctionClosure

inline HostFunctionClosure *makeHostFunctionClosure(
  HostFunctionClosure::Context context,
  HostFunctionClosure::Closure closure,
  HostFunctionClosure::Deallocator deallocator
) {
  return new HostFunctionClosure(context, closure, deallocator);
}

} // namespace expo`,
  },
  {
    file: "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/NativeState.h",
    marker: "inline NativeState *makeNativeState",
    find: "} SWIFT_IMMORTAL_REFERENCE; // class NativeState\n\n} // namespace expo",
    replacement: `} SWIFT_IMMORTAL_REFERENCE; // class NativeState

inline NativeState *makeNativeState(
  NativeState::Context context,
  NativeState::Deallocator deallocator
) {
  return new NativeState(context, deallocator);
}

} // namespace expo`,
  },
];

for (const patch of needsDowngrade ? cxxPatches : []) {
  const file = path.join(root, patch.file);
  if (!fs.existsSync(file)) {
    continue;
  }

  const source = fs.readFileSync(file, "utf8");
  if (source.includes(patch.marker)) {
    continue;
  }

  const patched = source.replace(patch.find, patch.replacement);
  if (patched !== source) {
    fs.writeFileSync(file, patched);
    console.log(`Patched ${patch.file} with Swift 6.1 C++ factories.`);
  }
}

const expoModulesJsiBuildScript = path.join(
  root,
  "node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh"
);

if (needsDowngrade && fs.existsSync(expoModulesJsiBuildScript)) {
  const source = fs.readFileSync(expoModulesJsiBuildScript, "utf8");
  const patched = source
    .replace(
      `  find "\${modules_dir}/\${PACKAGE_NAME}.swiftmodule" -type f \\
    \\( -name '*.private.swiftinterface' -o -name '*.package.swiftinterface' \\) -delete`,
      `  find "\${modules_dir}/\${PACKAGE_NAME}.swiftmodule" -type f ! -name '._*' \\
    \\( -name '*.private.swiftinterface' -o -name '*.package.swiftinterface' \\) -delete`
    )
    .replace(
      `    sed '/^extension __ObjC\\./,/^}/d;/^@usableFromInline$/{N;/_ConstraintThatIsNotPartOfTheAPIOfThisLibrary/d;};/_ConstraintThatIsNotPartOfTheAPIOfThisLibrary/d' "$swiftinterface" > "$stripped_swiftinterface"`,
      `    LC_ALL=C sed '/^extension __ObjC\\./,/^}/d;/^@usableFromInline$/{N;/_ConstraintThatIsNotPartOfTheAPIOfThisLibrary/d;};/_ConstraintThatIsNotPartOfTheAPIOfThisLibrary/d' "$swiftinterface" > "$stripped_swiftinterface"`
    )
    .replace(
      `  done < <(find "\${modules_dir}/\${PACKAGE_NAME}.swiftmodule" -name '*.swiftinterface')`,
      `  done < <(find "\${modules_dir}/\${PACKAGE_NAME}.swiftmodule" -type f ! -name '._*' -name '*.swiftinterface')`
    );

  if (patched !== source) {
    fs.writeFileSync(expoModulesJsiBuildScript, patched);
    console.log("Patched ExpoModulesJSI xcframework script for external-drive AppleDouble files.");
  }
}
