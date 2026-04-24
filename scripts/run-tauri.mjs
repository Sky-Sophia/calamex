import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const extraArgs = process.argv.slice(3);
const WINDOWS_VS_CUSTOM_ROOTS = [
    'D:\\Apps\\VisualStudio',
    'D:\\Dev\\VisualStudio',
];
const WINDOWS_VS_STANDARD_LAYOUTS = [
    '',
    'Community',
    '2022\\Community',
    'Microsoft Visual Studio\\2022\\Community',
];
const WINDOWS_VS_FALLBACK_PATHS = [
    ...WINDOWS_VS_CUSTOM_ROOTS.flatMap((rootPath) => WINDOWS_VS_STANDARD_LAYOUTS.map((suffix) => (
        suffix ? path.win32.join(rootPath, suffix) : rootPath
    ))),
    'D:\\WindowsApp\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
];

if (!mode) {
    console.error('缺少 tauri 子命令，例如 dev 或 build。');
    process.exit(1);
}

const parseFeatureTokens = (args) => {
    const features = [];

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];
        if (current === '--features' || current === '-F') {
            const nextValue = args[index + 1];
            if (nextValue) {
                features.push(...nextValue.split(',').map((value) => value.trim()).filter(Boolean));
                index += 1;
            }
            continue;
        }

        if (current.startsWith('--features=')) {
            features.push(...current.slice('--features='.length).split(',').map((value) => value.trim()).filter(Boolean));
            continue;
        }

        if (current.startsWith('-F') && current.length > 2) {
            features.push(...current.slice(2).split(',').map((value) => value.trim()).filter(Boolean));
        }
    }

    return features;
};

const hasVisualHostingFeature = (args) => parseFeatureTokens(args).includes('visual-hosting');

const warnIfVisualHostingRequested = () => {
    if (
        process.platform !== 'win32'
        || (mode !== 'dev' && mode !== 'build')
        || !hasVisualHostingFeature(extraArgs)
    ) {
        return;
    }

    console.warn('[run-tauri] cargo feature "visual-hosting" 已不再作为窗口 resize 方案启用。');
    console.warn('[run-tauri] 当前会继续使用标准 WebView2 windowed hosting + Windows redirection bitmap 路径。');
};

const compareVersion = (left, right) => {
    const leftParts = left.split('.').map((value) => Number.parseInt(value, 10) || 0);
    const rightParts = right.split('.').map((value) => Number.parseInt(value, 10) || 0);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
};

const listDirectories = (targetPath) => {
    if (!existsSync(targetPath)) {
        return [];
    }

    return readdirSync(targetPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
};

const joinEnvValues = (values) => values.filter(Boolean).join(path.delimiter);

const findCommandPath = (fileName, extraCandidates = []) => {
    const pathValue = process.env.PATH ?? '';
    for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
        const candidate = path.join(directory, fileName);
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    for (const candidate of extraCandidates) {
        if (candidate && existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
};

const hasCommand = (command) => {
    if (process.platform !== 'win32') {
        return true;
    }

    const result = spawnSync('where.exe', [command], {
        stdio: 'ignore',
        shell: false,
    });
    return result.status === 0;
};

const normalizeInstallationPath = (value) => value ? value.replace(/[\\/]+$/, '') : '';

const isVisualStudioInstallation = (installationPath) => (
    existsSync(path.join(installationPath, 'VC', 'Tools', 'MSVC'))
    && existsSync(path.join(installationPath, 'Common7', 'IDE'))
);

const collectVisualStudioInstallations = () => {
    const candidates = [];
    const seen = new Set();

    const register = (installationPath, displayName = 'Visual Studio 2022') => {
        const normalizedPath = normalizeInstallationPath(installationPath);
        if (!normalizedPath || seen.has(normalizedPath) || !isVisualStudioInstallation(normalizedPath)) {
            return;
        }

        seen.add(normalizedPath);
        candidates.push({
            installationPath: normalizedPath,
            displayName,
        });
    };

    const instance = loadVsInstance();
    if (instance?.installationPath) {
        register(instance.installationPath, instance.displayName ?? 'Visual Studio 2022');
    }

    for (const installationPath of WINDOWS_VS_FALLBACK_PATHS) {
        register(installationPath, 'Visual Studio Community 2022');
    }

    return candidates;
};

const findLatestMsvc = (installationPath) => {
    const toolsRoot = path.join(installationPath, 'VC', 'Tools', 'MSVC');
    const versions = listDirectories(toolsRoot).sort(compareVersion).reverse();

    for (const version of versions) {
        const versionRoot = path.join(toolsRoot, version);
        const include = path.join(versionRoot, 'include');
        const lib = path.join(versionRoot, 'lib', 'x64');
        const hostBins = [
            path.join(versionRoot, 'bin', 'Hostx64', 'x64'),
            path.join(versionRoot, 'bin', 'Hostx86', 'x64'),
        ];

        for (const bin of hostBins) {
            if (
                existsSync(path.join(bin, 'cl.exe'))
                && existsSync(include)
                && existsSync(lib)
            ) {
                return {
                    version,
                    root: versionRoot,
                    bin,
                    include,
                    lib,
                };
            }
        }
    }

    return null;
};

const findLatestWindowsSdk = () => {
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    if (!programFilesX86) {
        return null;
    }

    const sdkRoot = path.join(programFilesX86, 'Windows Kits', '10');
    const includeRoot = path.join(sdkRoot, 'Include');
    const versions = listDirectories(includeRoot)
        .filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value))
        .sort(compareVersion)
        .reverse();

    for (const version of versions) {
        const candidate = {
            version,
            root: sdkRoot,
            includeUcrt: path.join(includeRoot, version, 'ucrt'),
            includeShared: path.join(includeRoot, version, 'shared'),
            includeUm: path.join(includeRoot, version, 'um'),
            includeWinrt: path.join(includeRoot, version, 'winrt'),
            includeCppWinrt: path.join(includeRoot, version, 'cppwinrt'),
            libUcrt: path.join(sdkRoot, 'Lib', version, 'ucrt', 'x64'),
            libUm: path.join(sdkRoot, 'Lib', version, 'um', 'x64'),
            binVersioned: path.join(sdkRoot, 'bin', version, 'x64'),
            binFallback: path.join(sdkRoot, 'bin', 'x64'),
        };

        if (
            existsSync(candidate.includeUcrt) &&
            existsSync(candidate.includeShared) &&
            existsSync(candidate.includeUm) &&
            existsSync(candidate.libUcrt) &&
            existsSync(candidate.libUm)
        ) {
            return candidate;
        }
    }

    return null;
};

const loadVsInstance = () => {
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    if (!programFilesX86) {
        return null;
    }

    const vswherePath = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!existsSync(vswherePath)) {
        return null;
    }

    const result = spawnSync(vswherePath, ['-latest', '-products', '*', '-format', 'json'], {
        cwd: rootDir,
        encoding: 'utf8',
        shell: false,
    });

    if (result.status !== 0 || !result.stdout) {
        return null;
    }

    try {
        const instances = JSON.parse(result.stdout);
        return Array.isArray(instances) && instances.length > 0 ? instances[0] : null;
    } catch {
        return null;
    }
};

const buildWindowsToolchainEnv = () => {
    const installations = collectVisualStudioInstallations();
    if (installations.length === 0) {
        return {
            ok: false,
            reason: '未找到 Visual Studio 2022 实例。',
        };
    }

    for (const instance of installations) {
        const msvc = findLatestMsvc(instance.installationPath);
        if (!msvc) {
            continue;
        }

        const sdk = findLatestWindowsSdk();
        if (!sdk) {
            return {
                ok: false,
                reason: '未检测到可用的 Windows 10/11 SDK。',
                installationPath: instance.installationPath,
            };
        }

        const env = { ...process.env };
        const cargoExecutable = findCommandPath('cargo.exe', [
            path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'cargo.exe'),
        ]);
        const cargoBinDirectory = cargoExecutable ? path.dirname(cargoExecutable) : '';
        const nodeBinDirectory = path.dirname(process.execPath);
        env.PATH = joinEnvValues([
            msvc.bin,
            existsSync(sdk.binVersioned) ? sdk.binVersioned : sdk.binFallback,
            existsSync(sdk.binFallback) ? sdk.binFallback : '',
            cargoBinDirectory,
            nodeBinDirectory,
            env.PATH ?? '',
        ]);
        env.INCLUDE = joinEnvValues([
            msvc.include,
            sdk.includeUcrt,
            sdk.includeShared,
            sdk.includeUm,
            sdk.includeWinrt,
            sdk.includeCppWinrt,
            env.INCLUDE ?? '',
        ]);
        env.LIB = joinEnvValues([
            msvc.lib,
            sdk.libUcrt,
            sdk.libUm,
            env.LIB ?? '',
        ]);
        env.LIBPATH = joinEnvValues([msvc.lib, sdk.libUm, env.LIBPATH ?? '']);
        env.VSINSTALLDIR = `${instance.installationPath}${path.sep}`;
        env.VCINSTALLDIR = `${path.join(instance.installationPath, 'VC')}${path.sep}`;
        env.VCToolsInstallDir = `${msvc.root}${path.sep}`;
        env.VCToolsVersion = msvc.version;
        env.WindowsSdkDir = `${sdk.root}${path.sep}`;
        env.WindowsSdkVersion = `${sdk.version}${path.sep}`;
        env.UniversalCRTSdkDir = `${sdk.root}${path.sep}`;
        env.UCRTVersion = sdk.version;
        env.DevEnvDir = `${path.join(instance.installationPath, 'Common7', 'IDE')}${path.sep}`;
        env.Platform = 'x64';
        env.CC = env.CC || 'cl.exe';
        env.CXX = env.CXX || 'cl.exe';
        if (cargoExecutable) {
            env.CARGO = cargoExecutable;
        }

        return {
            ok: true,
            env,
        };
    }

    return {
        ok: false,
        reason: '已检测到 Visual Studio，但未找到可用的 x64 MSVC 编译工具链。',
        installationPath: installations[0]?.installationPath,
    };
};

const runTauri = (env) => {
    warnIfVisualHostingRequested();

    const cliScriptPath = path.join(
        rootDir,
        'node_modules',
        '@tauri-apps',
        'cli',
        'tauri.js',
    );

    if (!existsSync(cliScriptPath)) {
        console.error('未找到本地 Tauri CLI，请先执行 npm install。');
        process.exit(1);
    }

    const result = spawnSync(process.execPath, [cliScriptPath, mode, ...extraArgs], {
        cwd: rootDir,
        env,
        stdio: 'inherit',
        shell: false,
    });

    if (result.error) {
        console.error(result.error.message);
    }

    process.exit(result.status ?? 1);
};

if (process.platform !== 'win32') {
    runTauri(process.env);
}

if (hasCommand('cl.exe') && process.env.VCINSTALLDIR && process.env.WindowsSdkDir) {
    runTauri(process.env);
}

const toolchain = buildWindowsToolchainEnv();
if (!toolchain.ok) {
    console.error('Tauri 启动前检查失败。');
    console.error(toolchain.reason);
    if (toolchain.installationPath) {
        console.error(`Visual Studio 安装路径: ${toolchain.installationPath}`);
    }
    console.error(`请通过仓库根目录的 .vsconfig 或 Visual Studio Installer 补装“使用 C++ 的桌面开发”。`);
    process.exit(1);
}

runTauri(toolchain.env);
