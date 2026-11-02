import { ApiError } from './errors.js';
import { SERVER_VERSION } from './version.js';

export type QueryValue = string | number | null | undefined;

export interface KualatClientOptions {
    /** Request timeout in seconds. */
    timeout?: number;
}

export class KualatClient {
    private readonly baseUrl: string;

    private readonly apiKey: string;

    private readonly timeoutSeconds: number;

    constructor(baseUrl: string, apiKey: string, options: KualatClientOptions = {}) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
        const timeout = options.timeout ?? 30;
        this.timeoutSeconds = timeout > 0 ? timeout : 30;

        // Fail at startup rather than on the first call.
        new URL(`${this.baseUrl}/`);
    }

    async request(
        method: string,
        path: string,
        body?: Record<string, unknown>,
        query?: Record<string, QueryValue>,
    ): Promise<unknown> {
        const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`);

        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value !== null && value !== undefined && value !== '') {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'User-Agent': `kualat-mcp/${SERVER_VERSION}`,
        };

        const payload = body !== undefined && Object.keys(body).length > 0 ? JSON.stringify(body) : null;
        if (payload !== null) {
            headers['Content-Type'] = 'application/json';
        }

        let response: Response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body: payload,
                signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
            });
        } catch (error) {
            throw new ApiError(transportMessage(error, this.timeoutSeconds));
        }

        const raw = await response.text();

        if (response.status >= 400) {
            throw new ApiError(`HTTP ${response.status}: ${errorDetail(raw)}`, response.status);
        }

        return parseJson(raw);
    }
}

function parseJson(raw: string): unknown {
    if (raw === '') {
        return null;
    }

    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}

function errorDetail(raw: string): string {
    const decoded = parseJson(raw);

    if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
        const container = decoded as Record<string, unknown>;
        for (const key of ['detail', 'message', 'title'] as const) {
            const value = container[key];
            if (typeof value === 'string' && value !== '') {
                return value;
            }
            if (value !== null && value !== undefined) {
                return JSON.stringify(value);
            }
        }
    }

    return raw !== '' ? raw : 'The API returned an empty error body.';
}

function transportMessage(error: unknown, timeoutSeconds: number): string {
    const name = error instanceof Error ? error.name : '';

    if (name === 'TimeoutError' || name === 'AbortError') {
        return `The request timed out after ${timeoutSeconds} seconds.`;
    }

    // Node surfaces DNS and TLS failures on `cause`, not on `message`.
    const cause = error instanceof Error ? error.cause : undefined;

    if (cause instanceof Error && cause.message !== '') {
        return cause.message;
    }

    return error instanceof Error && error.message !== '' ? error.message : 'The request failed.';
}
