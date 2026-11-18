// Minimal GitHub "contents" API client. The admin dashboard saves the catalogue and images
// as commits to the shop's GitHub repository; the host (Walakulu) then republishes the site.

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export function textToBase64(text) {
  const bytes = utf8.encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return fromUtf8.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHub {
  constructor({ owner, repo, branch = 'main', token, apiBase = 'https://api.github.com' }) {
    Object.assign(this, { owner, repo, branch, token, apiBase: apiBase.replace(/\/+$/, '') });
  }

  contentsUrl(path) {
    return `${this.apiBase}/repos/${this.owner}/${this.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(0, 'Could not reach GitHub. Check your internet connection.');
    }
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
      if (res.status === 401) throw new GitHubError(401, 'GitHub rejected the access token. It may have expired or been revoked.');
      if (res.status === 403) throw new GitHubError(403, `GitHub refused the request. The token needs “Contents: Read and write” on this repository. ${detail}`);
      if (res.status === 404) throw new GitHubError(404, 'Repository or branch not found. Check the owner, repository and branch names.');
      if (res.status === 409 || res.status === 422) throw new GitHubError(res.status, 'The file was changed somewhere else since you opened it.');
      throw new GitHubError(res.status, `GitHub error ${res.status}. ${detail}`);
    }
    return res.json();
  }

  /** Checks the connection. Returns the repository info or throws a readable error. */
  async verify() {
    const info = await this.request('GET', `${this.apiBase}/repos/${this.owner}/${this.repo}`);
    if (!info) throw new GitHubError(404, 'Repository not found, or the token cannot see it. Check the owner and repository names.');
    return info;
  }

  /** Returns { sha, text } or null when the file does not exist. */
  async getFile(path) {
    const j = await this.request('GET', `${this.contentsUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (!j || Array.isArray(j) || typeof j.content !== 'string') return null;
    return { sha: j.sha, text: base64ToText(j.content) };
  }

  /** Create or update a file from base64 content. Returns the new blob sha. */
  async putBase64(path, contentB64, message, sha) {
    const j = await this.request('PUT', this.contentsUrl(path), {
      message, content: contentB64, branch: this.branch, ...(sha ? { sha } : {}),
    });
    return j.content.sha;
  }

  putText(path, text, message, sha) { return this.putBase64(path, textToBase64(text), message, sha); }
}
