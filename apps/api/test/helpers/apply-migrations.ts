const SQL_FILES = import.meta.glob<string>(
	'../../migrations/*.sql',
	{ eager: true, query: '?raw', import: 'default' },
);

function parseStatements(sql: string): string[] {
	const lines = sql.split('\n');
	const filtered = lines
		.filter(line => !line.trim().startsWith('--'))
		.join('\n');

	return filtered
		.split(';')
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

export async function applyMigrations(db: D1Database): Promise<void> {
	const sorted = Object.entries(SQL_FILES).sort(([a], [b]) => a.localeCompare(b));
	const statements: string[] = [];
	for (const [, content] of sorted) {
		statements.push(...parseStatements(content));
	}
	await db.batch(statements.map(sql => db.prepare(sql)));
}
