import { describe, expect, it } from 'vitest';
import {
  areFileSystemPathsEqual,
  getPathBaseName,
  normalizeFileSystemPath,
} from '@/utils/path';

describe('path utils', () => {
  it('会移除 Windows 扩展路径前缀，避免面包屑出现问号段', () => {
    expect(normalizeFileSystemPath(String.raw`\\?\D:\test\xiaojianc.sh`)).toBe(
      'd:/test/xiaojianc.sh',
    );
    expect(normalizeFileSystemPath('//?/D:/test/xiaojianc.sh')).toBe(
      'd:/test/xiaojianc.sh',
    );
  });

  it('会保留 UNC 路径语义并移除扩展路径前缀', () => {
    expect(normalizeFileSystemPath(String.raw`\\?\UNC\SERVER\Share\xiaojianc.sh`)).toBe(
      '//server/share/xiaojianc.sh',
    );
    expect(normalizeFileSystemPath('//?/UNC/SERVER/Share/xiaojianc.sh')).toBe(
      '//server/share/xiaojianc.sh',
    );
    expect(normalizeFileSystemPath('//?/unc/SERVER/Share/xiaojianc.sh')).toBe(
      '//server/share/xiaojianc.sh',
    );
  });

  it('使用规范化后的扩展路径参与文件名和路径相等判断', () => {
    expect(getPathBaseName(String.raw`\\?\D:\test\xiaojianc.sh`)).toBe('xiaojianc.sh');
    expect(areFileSystemPathsEqual(String.raw`\\?\D:\test\xiaojianc.sh`, 'd:/test/xiaojianc.sh'))
      .toBe(true);
  });
});
