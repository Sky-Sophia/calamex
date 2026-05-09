import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const DEFAULT_LOCAL_TIMEZONE = 'Asia/Shanghai';

const optionalNullableStringSchema = z.string().nullish().optional();

const currentTimeBaseInputSchema = z.object({
  timezone: z.string()
    .optional()
    .describe('IANA timezone name. If omitted, use the local timezone.'),
});

const currentTimeToolInputSchema = z.object({
  timezone: optionalNullableStringSchema
    .describe('IANA timezone name. If omitted, use the local timezone.'),
  input: z.object({
    timezone: optionalNullableStringSchema,
  }).passthrough().nullish().optional(),
  arguments: z.object({
    timezone: optionalNullableStringSchema,
  }).passthrough().nullish().optional(),
}).passthrough();

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const unwrapModelToolInput = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  const nestedInput = value.input;
  const nestedArguments = value.arguments;

  if (isObjectRecord(nestedInput)) {
    return nestedInput;
  }

  if (isObjectRecord(nestedArguments)) {
    return nestedArguments;
  }

  return value;
};

const removeNullishFields = (
  value: unknown,
  fields: readonly string[],
): unknown => {
  if (!isObjectRecord(value)) {
    return value;
  }

  let normalized: Record<string, unknown> | null = null;

  for (const field of fields) {
    if (value[field] !== null && value[field] !== undefined) {
      continue;
    }

    normalized ??= { ...value };
    delete normalized[field];
  }

  return normalized ?? value;
};

const currentTimeNormalizedInputSchema = z.preprocess(
  (value) => removeNullishFields(unwrapModelToolInput(value), ['timezone']),
  currentTimeBaseInputSchema,
);

const timeSnapshotSchema = z.object({
  timezone: z.string(),
  datetime: z.string(),
  day_of_week: z.string(),
  is_dst: z.boolean(),
});

const convertTimeBaseInputSchema = z.object({
  source_timezone: z.string()
    .optional()
    .describe('Source IANA timezone name. If omitted, use the local timezone.'),
  time: z.string()
    .describe('Time to convert in 24-hour format (HH:MM or HH:MM:SS).'),
  target_timezone: z.string()
    .optional()
    .describe('Target IANA timezone name. If omitted, use the local timezone.'),
});

const convertTimeToolInputSchema = z.object({
  source_timezone: optionalNullableStringSchema
    .describe('Source IANA timezone name. If omitted, use the local timezone.'),
  time: z.string()
    .optional()
    .describe('Time to convert in 24-hour format (HH:MM or HH:MM:SS).'),
  target_timezone: optionalNullableStringSchema
    .describe('Target IANA timezone name. If omitted, use the local timezone.'),
  input: z.object({
    source_timezone: optionalNullableStringSchema,
    time: z.string().optional(),
    target_timezone: optionalNullableStringSchema,
  }).passthrough().nullish().optional(),
  arguments: z.object({
    source_timezone: optionalNullableStringSchema,
    time: z.string().optional(),
    target_timezone: optionalNullableStringSchema,
  }).passthrough().nullish().optional(),
}).passthrough();

const convertTimeNormalizedInputSchema = z.preprocess(
  (value) => removeNullishFields(unwrapModelToolInput(value), ['source_timezone', 'target_timezone']),
  convertTimeBaseInputSchema,
);

const convertTimeOutputSchema = z.object({
  source: timeSnapshotSchema,
  target: timeSnapshotSchema,
  time_difference: z.string(),
});

type TTimeSnapshot = z.infer<typeof timeSnapshotSchema>;
type TCurrentTimeInput = z.infer<typeof currentTimeBaseInputSchema>;
type TConvertTimeInput = z.infer<typeof convertTimeBaseInputSchema>;

interface IDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface IParsedClockTime {
  hour: number;
  minute: number;
  second: number;
}

export interface IMastraTimeToolOptions {
  now?: () => Date;
  localTimezone?: string;
}

const normalizeUnicodeText = (value: string): string => value.normalize('NFKC').trim();

const createDateTimeFormatter = (timezone: string): Intl.DateTimeFormat => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  hour12: false,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const createWeekdayFormatter = (timezone: string): Intl.DateTimeFormat => new Intl.DateTimeFormat('en-US', {
  timeZone: timezone,
  weekday: 'long',
});

const validateTimezone = (value: string): string => {
  const normalized = normalizeUnicodeText(value);

  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: normalized }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`无效时区：${value}`);
  }
};

const resolveLocalTimezone = (configuredTimezone?: string): string => {
  const normalized = configuredTimezone ? normalizeUnicodeText(configuredTimezone) : '';

  if (!normalized) {
    return DEFAULT_LOCAL_TIMEZONE;
  }

  try {
    return validateTimezone(normalized);
  } catch {
    return DEFAULT_LOCAL_TIMEZONE;
  }
};

const resolveTimezone = (value: string | undefined, fallbackTimezone: string): string => {
  const normalized = value ? normalizeUnicodeText(value) : '';
  return normalized ? validateTimezone(normalized) : fallbackTimezone;
};

const parseCurrentTimeInput = (value: unknown): TCurrentTimeInput => currentTimeNormalizedInputSchema.parse(value);
const parseConvertTimeInput = (value: unknown): TConvertTimeInput => convertTimeNormalizedInputSchema.parse(value);

const getDateTimeParts = (date: Date, timezone: string): IDateTimeParts => {
  const parts = createDateTimeFormatter(timezone).formatToParts(date);
  const values: Partial<IDateTimeParts> = {};

  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day'
      || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
      values[part.type] = Number(part.value);
    }
  }

  if (
    values.year === undefined
    || values.month === undefined
    || values.day === undefined
    || values.hour === undefined
    || values.minute === undefined
    || values.second === undefined
  ) {
    throw new Error(`无法读取时区 ${timezone} 的日期时间。`);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const getTimezoneOffsetMinutes = (date: Date, timezone: string): number => {
  const parts = getDateTimeParts(date, timezone);
  const zonedTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return Math.round((zonedTimestamp - date.getTime()) / 60_000);
};

const formatTimezoneOffset = (offsetMinutes: number): string => {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;

  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const isDaylightSavingTime = (date: Date, timezone: string): boolean => {
  const zoned = getDateTimeParts(date, timezone);
  const januaryOffset = getTimezoneOffsetMinutes(
    new Date(Date.UTC(zoned.year, 0, 1, 12, 0, 0)),
    timezone,
  );
  const julyOffset = getTimezoneOffsetMinutes(
    new Date(Date.UTC(zoned.year, 6, 1, 12, 0, 0)),
    timezone,
  );

  if (januaryOffset === julyOffset) {
    return false;
  }

  const currentOffset = getTimezoneOffsetMinutes(date, timezone);
  return currentOffset === Math.max(januaryOffset, julyOffset);
};

const createTimeSnapshot = (date: Date, timezone: string): TTimeSnapshot => {
  const parts = getDateTimeParts(date, timezone);
  const offsetMinutes = getTimezoneOffsetMinutes(date, timezone);

  return {
    timezone,
    datetime: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}${formatTimezoneOffset(offsetMinutes)}`,
    day_of_week: createWeekdayFormatter(timezone).format(date),
    is_dst: isDaylightSavingTime(date, timezone),
  };
};

const parseClockTime = (value: string): IParsedClockTime => {
  const normalized = normalizeUnicodeText(value);
  const matched = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u);

  if (!matched) {
    throw new Error('时间格式无效：请使用 24 小时制 HH:MM 或 HH:MM:SS。');
  }

  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const second = Number(matched[3] ?? '0');

  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error('时间超出有效范围：小时需在 00-23，分钟和秒需在 00-59。');
  }

  return {
    hour,
    minute,
    second,
  };
};

const createUtcTimestampFromParts = (parts: IDateTimeParts): number => Date.UTC(
  parts.year,
  parts.month - 1,
  parts.day,
  parts.hour,
  parts.minute,
  parts.second,
);

const hasSameDateTimeParts = (left: IDateTimeParts, right: IDateTimeParts): boolean => (
  left.year === right.year
  && left.month === right.month
  && left.day === right.day
  && left.hour === right.hour
  && left.minute === right.minute
  && left.second === right.second
);

const zonedDateTimeToDate = (parts: IDateTimeParts, timezone: string): Date => {
  let candidateTimestamp = createUtcTimestampFromParts(parts);

  for (let index = 0; index < 4; index += 1) {
    const candidate = new Date(candidateTimestamp);
    const candidateParts = getDateTimeParts(candidate, timezone);

    if (hasSameDateTimeParts(candidateParts, parts)) {
      return candidate;
    }

    candidateTimestamp += createUtcTimestampFromParts(parts) - createUtcTimestampFromParts(candidateParts);
  }

  const finalCandidate = new Date(candidateTimestamp);
  if (!hasSameDateTimeParts(getDateTimeParts(finalCandidate, timezone), parts)) {
    throw new Error(`无法解析 ${timezone} 中的时间，可能命中了夏令时切换边界。`);
  }

  return finalCandidate;
};

const formatTimeDifference = (offsetMinutes: number): string => {
  const decimals = offsetMinutes % 60 === 0 || offsetMinutes % 30 === 0 ? 1 : 2;
  const hours = offsetMinutes / 60;
  const sign = hours >= 0 ? '+' : '';

  return `${sign}${hours.toFixed(decimals)}h`;
};

export const createMastraTimeTools = (
  options: IMastraTimeToolOptions = {},
): Record<'get_current_time' | 'convert_time', ReturnType<typeof createTool>> => {
  const now = options.now ?? (() => new Date());
  const localTimezone = resolveLocalTimezone(options.localTimezone ?? process.env.AGENT_MCP_LOCAL_TIMEZONE);

  return {
    get_current_time: createTool({
      id: 'get_current_time',
      description: 'Get current time in a timezone. If the user does not specify one, use the local timezone.',
      inputSchema: currentTimeToolInputSchema,
      outputSchema: timeSnapshotSchema,
      strict: true,
      inputExamples: [
        { input: {} },
        { input: { timezone: 'Asia/Shanghai' } },
        { input: { timezone: 'America/New_York' } },
      ],
      execute: async (inputData) => {
        const { timezone } = parseCurrentTimeInput(inputData);

        return createTimeSnapshot(
          now(),
          resolveTimezone(timezone, localTimezone),
        );
      },
    }),
    convert_time: createTool({
      id: 'convert_time',
      description: 'Convert a wall-clock time between timezones. If a timezone is omitted, use the local timezone.',
      inputSchema: convertTimeToolInputSchema,
      outputSchema: convertTimeOutputSchema,
      strict: true,
      inputExamples: [
        {
          input: {
            source_timezone: 'Asia/Shanghai',
            time: '18:30',
            target_timezone: 'America/New_York',
          },
        },
        {
          input: {
            source_timezone: 'America/New_York',
            time: '09:00',
            target_timezone: 'Europe/London',
          },
        },
      ],
      execute: async (inputData) => {
        const { source_timezone, time, target_timezone } = parseConvertTimeInput(inputData);
        const sourceTimezone = resolveTimezone(source_timezone, localTimezone);
        const targetTimezone = resolveTimezone(target_timezone, localTimezone);
        const parsedTime = parseClockTime(time);
        const sourceDateParts = getDateTimeParts(now(), sourceTimezone);
        const sourceDate = zonedDateTimeToDate({
          year: sourceDateParts.year,
          month: sourceDateParts.month,
          day: sourceDateParts.day,
          hour: parsedTime.hour,
          minute: parsedTime.minute,
          second: parsedTime.second,
        }, sourceTimezone);
        const source = createTimeSnapshot(sourceDate, sourceTimezone);
        const target = createTimeSnapshot(sourceDate, targetTimezone);
        const timeDifference = formatTimeDifference(
          getTimezoneOffsetMinutes(sourceDate, targetTimezone) - getTimezoneOffsetMinutes(sourceDate, sourceTimezone),
        );

        return {
          source,
          target,
          time_difference: timeDifference,
        };
      },
    }),
  };
};
