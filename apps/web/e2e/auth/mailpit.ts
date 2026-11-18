interface MailpitMessageSummary {
  ID?: string;
  id?: string;
}

interface MailpitSearchResult {
  Messages?: MailpitMessageSummary[];
  messages?: MailpitMessageSummary[];
}

const mailpitUrl = process.env.LASH_MAILPIT_URL ?? 'http://127.0.0.1:55324';

export const latestSignInLink = async (email: string): Promise<string | null> => {
  const search = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  if (!search.ok) return null;
  const result = (await search.json()) as MailpitSearchResult;
  const message = (result.Messages ?? result.messages ?? [])[0];
  const id = message?.ID ?? message?.id;
  if (!id) return null;

  const rendered = await fetch(`${mailpitUrl}/view/${encodeURIComponent(id)}.html`);
  if (!rendered.ok) return null;
  const html = await rendered.text();
  const href = html.match(/href=["']([^"']+)["']/iu)?.[1];
  return href?.replaceAll('&amp;', '&') ?? null;
};
