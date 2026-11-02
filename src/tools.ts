import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { ApiError } from './errors.js';
import type { KualatClient } from './client.js';

export interface ToolDefinition {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly schema: z.ZodType;
	readonly annotations: ToolAnnotations;
	readonly run: (client: KualatClient, args: unknown) => Promise<unknown>;
}

function defineTool<S extends z.ZodType>(definition: {
	name: string;
	title: string;
	description: string;
	annotations: ToolAnnotations;
	schema: S;
	handler: (client: KualatClient, args: z.output<S>) => Promise<unknown>;
}): ToolDefinition {
	return {
		name: definition.name,
		title: definition.title,
		description: definition.description,
		annotations: definition.annotations,
		schema: definition.schema,
		run: (client, args) => definition.handler(client, definition.schema.parse(args) as z.output<S>),
	};
}

function annotations(readOnly: boolean, destructive: boolean): ToolAnnotations {
	return {
		readOnlyHint: readOnly,
		destructiveHint: destructive,
		openWorldHint: true,
	};
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dataOf(response: unknown): unknown {
	if (isJsonObject(response) && 'data' in response) {
		return response.data;
	}

	return response;
}

function paginationOf(response: unknown): unknown {
	const container = isJsonObject(response) ? response : null;
	const meta = container && isJsonObject(container.meta) ? container.meta : null;
	return meta && isJsonObject(meta.pagination) ? meta.pagination : null;
}

const WEBHOOK_EVENTS = ['link.created', 'link.updated', 'link.deleted', 'link.clicked', 'ping', '*'] as const;

export const TOOLS: readonly ToolDefinition[] = [
	defineTool({
		name: 'shorten_link',
		title: 'Shorten a link',
		description: 'Create a short link on the account. Returns the short URL, alias and link id.',
		annotations: annotations(false, false),
		schema: z.strictObject({
			url: z.string().trim().min(1).describe('Destination URL, including the scheme.'),
			custom: z.string().optional().describe('Readable alias instead of a generated one.'),
			domain: z.string().optional().describe('Branded domain connected to the account.'),
			password: z.string().optional().describe('Password visitors must enter before the redirect.'),
			expiry: z.string().optional().describe('Expiry date, ISO 8601 or "YYYY-MM-DD HH:MM:SS".'),
			title: z.string().optional().describe('Meta title shown in link previews.'),
			description: z.string().optional().describe('Internal note about the link.'),
		}),
		handler: async (client, args) => {
			const body: Record<string, unknown> = { url: args.url };

			for (const key of ['custom', 'domain', 'password', 'expiry'] as const) {
				const value = args[key];
				if (value !== undefined && value !== '') {
					body[key] = value;
				}
			}

			if (args.title !== undefined && args.title !== '') {
				body.metatitle = args.title;
			}

			if (args.description !== undefined && args.description !== '') {
				body.description = args.description;
			}

			return dataOf(await client.request('POST', '/links', body));
		},
	}),
	defineTool({
		name: 'list_links',
		title: 'List links',
		description: 'Page through the links of the account, newest first by default.',
		annotations: annotations(true, false),
		schema: z.strictObject({
			limit: z.coerce.number().int().min(1).max(100).optional().describe('Rows per page. Default 15.'),
			page: z.coerce.number().int().min(1).optional().describe('Page number, starting at 1.'),
			search: z.string().optional().describe('Match the destination URL, alias or title.'),
			order: z.enum(['date', 'click']).optional().describe('Sort by creation date or click count.'),
		}),
		handler: async (client, args) => {
			const response = await client.request('GET', '/links', undefined, {
				limit: args.limit ?? 15,
				page: args.page ?? 1,
				q: args.search ?? null,
				order: args.order ?? null,
			});

			const container = isJsonObject(response) ? response : null;

			return {
				links: container && Array.isArray(container.data) ? container.data : [],
				pagination: paginationOf(response),
			};
		},
	}),
	defineTool({
		name: 'get_link',
		title: 'Get a link',
		description: 'Read one link with its click statistics, split by country, referrer, browser and OS.',
		annotations: annotations(true, false),
		schema: z.strictObject({
			id: z.coerce.number().int().positive().describe('Link id.'),
		}),
		handler: async (client, args) => dataOf(await client.request('GET', `/links/${args.id}`)),
	}),
	defineTool({
		name: 'update_link',
		title: 'Update a link',
		description: 'Change a link. The API replaces the optional settings it does not receive, so pass every field you want to keep.',
		annotations: annotations(false, false),
		schema: z.strictObject({
			id: z.coerce.number().int().positive().describe('Link id.'),
			url: z.string().optional().describe('New destination URL.'),
			custom: z.string().optional().describe('New custom alias.'),
			password: z.string().optional().describe('New password, or an empty string to remove it.'),
			expiry: z.string().optional().describe('Expiry date, ISO 8601 or "YYYY-MM-DD HH:MM:SS".'),
			title: z.string().optional().describe('Meta title.'),
			description: z.string().optional().describe('Internal note.'),
		}),
		handler: async (client, args) => {
			const body: Record<string, unknown> = {};

			if (args.url !== undefined) {
				body.url = args.url;
			}
			if (args.custom !== undefined) {
				body.custom = args.custom;
			}
			if (args.password !== undefined) {
				body.password = args.password;
			}
			if (args.expiry !== undefined) {
				body.expiry = args.expiry;
			}
			if (args.title !== undefined) {
				body.metatitle = args.title;
			}
			if (args.description !== undefined) {
				body.description = args.description;
			}

			if (Object.keys(body).length === 0) {
				throw new ApiError('Pass at least one field to change.');
			}

			return dataOf(await client.request('PATCH', `/links/${args.id}`, body));
		},
	}),
	defineTool({
		name: 'delete_link',
		title: 'Delete a link',
		description: 'Delete a link permanently, together with its click statistics. This cannot be undone.',
		annotations: annotations(false, true),
		schema: z.strictObject({
			id: z.coerce.number().int().positive().describe('Link id.'),
		}),
		handler: async (client, args) => {
			await client.request('DELETE', `/links/${args.id}`);
			return { id: args.id, deleted: true };
		},
	}),
	defineTool({
		name: 'get_account',
		title: 'Get account',
		description: 'Account profile, plan, quotas and usage counters.',
		annotations: annotations(true, false),
		schema: z.strictObject({}),
		handler: async (client) => dataOf(await client.request('GET', '/account')),
	}),
	defineTool({
		name: 'list_domains',
		title: 'List domains',
		description: 'Branded domains connected to the account and their DNS status.',
		annotations: annotations(true, false),
		schema: z.strictObject({
			limit: z.coerce.number().int().min(1).max(100).optional(),
			page: z.coerce.number().int().min(1).optional(),
		}),
		handler: async (client, args) => {
			const response = await client.request('GET', '/domains', undefined, {
				limit: args.limit ?? 15,
				page: args.page ?? 1,
			});

			const container = isJsonObject(response) ? response : null;

			return {
				domains: container && Array.isArray(container.data) ? container.data : [],
				pagination: paginationOf(response),
			};
		},
	}),
	defineTool({
		name: 'list_webhooks',
		title: 'List webhooks',
		description: 'Webhook subscriptions of the account, including their event filter, last delivery status and failure count.',
		annotations: annotations(true, false),
		schema: z.strictObject({
			limit: z.coerce.number().int().min(1).max(100).optional(),
			page: z.coerce.number().int().min(1).optional(),
		}),
		handler: async (client, args) => {
			const response = await client.request('GET', '/webhooks', undefined, {
				limit: args.limit ?? 15,
				page: args.page ?? 1,
			});

			const container = isJsonObject(response) ? response : null;

			return {
				webhooks: container && Array.isArray(container.data) ? container.data : [],
				pagination: paginationOf(response),
			};
		},
	}),
	defineTool({
		name: 'create_webhook',
		title: 'Create a webhook',
		description:
			'Subscribe an endpoint to link events. The response carries the signing secret (whsec_); deliveries follow the Standard Webhooks spec, signed with HMAC-SHA256 over "{id}.{timestamp}.{payload}".',
		annotations: annotations(false, false),
		schema: z.strictObject({
			url: z.string().trim().min(1).describe('Public http or https endpoint that receives the POST.'),
			events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).describe('Events to receive.'),
			name: z.string().optional().describe('Label to recognise the subscription by.'),
		}),
		handler: async (client, args) => {
			const body: Record<string, unknown> = { url: args.url, events: [...args.events] };

			if (args.name !== undefined && args.name !== '') {
				body.name = args.name;
			}

			return dataOf(await client.request('POST', '/webhooks', body));
		},
	}),
	defineTool({
		name: 'delete_webhook',
		title: 'Delete a webhook',
		description: 'Remove a webhook subscription and its delivery log. This cannot be undone.',
		annotations: annotations(false, true),
		schema: z.strictObject({
			id: z.coerce.number().int().positive().describe('Subscription id.'),
		}),
		handler: async (client, args) => {
			await client.request('DELETE', `/webhooks/${args.id}`);
			return { id: args.id, deleted: true };
		},
	}),
	defineTool({
		name: 'test_webhook',
		title: 'Test a webhook',
		description:
			'Deliver a ping immediately and report the endpoint response code, so a broken endpoint shows up before the workflow depends on it.',
		annotations: annotations(false, false),
		schema: z.strictObject({
			id: z.coerce.number().int().positive().describe('Subscription id.'),
		}),
		handler: async (client, args) => dataOf(await client.request('POST', `/webhooks/${args.id}/test`)),
	}),
];
