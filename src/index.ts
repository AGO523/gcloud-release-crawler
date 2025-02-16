import puppeteer from '@cloudflare/puppeteer';

interface Env {
	BROWSER: Fetcher;
	DB: D1Database;
}

interface ReleaseNote {
	release_at: string;
	resource_name: string;
	type: string;
	sub_title: string;
	content: string;
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		// last_released_at の固定値を設定
		const lastReleasedAt = 'February 13, 2025';
		const lastReleasedTimestamp = Date.parse(lastReleasedAt);

		// Puppeteer の起動
		const browser = await puppeteer.launch(env.BROWSER);
		const page = await browser.newPage();
		await page.goto('https://cloud.google.com/release-notes');

		// クロール処理
		const releaseNotes: ReleaseNote[] = await page.evaluate((lastReleasedAt: string) => {
			interface MyElement {
				textContent: string | null;
				closest(selector: string): MyElement | null;
				querySelector(selector: string): MyElement | null;
				classList: { contains(className: string): boolean };
			}

			// @ts-ignore
			const notes = Array.from(document.querySelectorAll('.release-note')) as MyElement[];

			return notes
				.map((note) => {
					const releaseAt =
						note.closest('.devsite-article')?.querySelector('.devsite-heading[role="heading"][aria-level="2"]')?.textContent?.trim() ||
						'Unknown Date';

					// リリース日を Date オブジェクトに変換
					const releaseTimestamp = Date.parse(releaseAt);

					// last_released_at 以前のデータは無視
					if (isNaN(releaseTimestamp) || releaseTimestamp <= Date.parse(lastReleasedAt)) {
						return null;
					}

					const resourceName = note.querySelector('.release-note-product-title')?.textContent?.trim() || 'Unknown Resource';
					const subTitle = note.querySelector('.devsite-heading[role="heading"][aria-level="3"]')?.textContent?.trim() || 'No Subtitle';

					const typeElement = note.closest('.release-feature') || note.closest('.release-changed');
					const type = typeElement?.classList.contains('release-feature')
						? 'feature'
						: typeElement?.classList.contains('release-changed')
						? 'changed'
						: 'unknown';

					const content = typeElement
						? typeElement.textContent?.split('before').slice(1).join('before').trim() || 'No Content'
						: 'No Content';

					return { release_at: releaseAt, resource_name: resourceName, type, sub_title: subTitle, content };
				})
				.filter((note): note is ReleaseNote => note !== null);
		}, lastReleasedAt);

		// Puppeteer の終了
		await browser.close();

		// D1 へデータを保存
		for (const note of releaseNotes) {
			await env.DB.prepare('INSERT INTO release_notes (release_at, resource_name, type, sub_title, content) VALUES (?, ?, ?, ?, ?)')
				.bind(note.release_at, note.resource_name, note.type, note.sub_title, note.content)
				.run();
		}

		return new Response(JSON.stringify({ status: 'success', notes: releaseNotes }), {
			headers: { 'Content-Type': 'application/json' },
		});
	},
} satisfies ExportedHandler<Env>;
