export type ParsedArgs = {
  command: string;
  positionals: string[];
  options: Record<string, string | boolean | string[]>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "bookshelf", ...rest] = argv;
  const positionals: string[] = [];
  const options: Record<string, string | boolean | string[]> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const [rawKey, inlineValue] = withoutPrefix.split("=", 2);
    const key = rawKey ?? "";
    if (!key) {
      continue;
    }
    const next = rest[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? next : true);
    if (inlineValue === undefined && value === next) {
      index += 1;
    }
    if (options[key] !== undefined) {
      const current = options[key];
      options[key] = Array.isArray(current) ? [...current, String(value)] : [String(current), String(value)];
    } else {
      options[key] = value;
    }
  }

  return { command, positionals, options };
}

export function getStringOption(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

export function getBooleanOption(args: ParsedArgs, name: string): boolean {
  return args.options[name] === true || args.options[name] === "true";
}

export function getListOption(args: ParsedArgs, name: string): string[] {
  const value = args.options[name];
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [String(value)];
  return values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
}

export function requireStringOption(args: ParsedArgs, name: string): string {
  const value = getStringOption(args, name);
  if (!value) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
}
