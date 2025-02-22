import { BigQuery } from '@google-cloud/bigquery';

interface Env {
	DB: D1Database;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		await fetchAndStoreReleaseNotes(env);
	},
};

async function fetchAndStoreReleaseNotes(env: Env) {
	const bigquery = new BigQuery();

	// JST（日本標準時）で今日の日付を取得（YYYY-MM-DD）
	const today = new Date()
		.toLocaleDateString('ja-JP', {
			timeZone: 'Asia/Tokyo',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		})
		.split('/')
		.join('-'); // 2025/02/18 → 2025-02-18 に変換

	// D1 から最新の published_at を取得
	const latestPublishedAtResult = await env.DB.prepare('SELECT MAX(published_at) AS latest_published_at FROM release_notes').first<{
		latest_published_at: string;
	}>();

	const latestPublishedAt = latestPublishedAtResult?.latest_published_at || '2000-01-01'; // デフォルト値（最初の取得時）

	console.log(`Fetching release notes from ${latestPublishedAt} to ${today}`);

	// BigQuery クエリ
	const query = `
    SELECT product_name, description, release_note_type, published_at
    FROM \`bigquery-public-data.google_cloud_release_notes.release_notes\`
    WHERE DATE(published_at) BETWEEN @latestPublishedAt AND @today
    ORDER BY published_at ASC
  `;

	const options = {
		query,
		params: { latestPublishedAt, today },
		location: 'US',
	};

	try {
		const [rows, job] = await bigquery.query(options);

		if (rows.length === 0) {
			console.log(`No new release notes found between ${latestPublishedAt} and ${today}`);
			return;
		}

		// D1 にデータを保存
		const batch = env.DB.prepare(
			'INSERT INTO release_notes (product_name, description, release_note_type, published_at) VALUES (?, ?, ?, ?)'
		);
		const insertPromises = rows.map((row) => batch.bind(row.product_name, row.description, row.release_note_type, row.published_at).run());

		await Promise.all(insertPromises);
		console.log(`Stored ${rows.length} new release notes in D1`);
	} catch (error) {
		console.error('Error fetching/storing release notes:', error);
	}
}
