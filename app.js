const https = require('https');
const fs = require('fs');

const API = 'https://api.github.com/';
const mods = JSON.parse(fs.readFileSync('mods.json', 'utf8')).mods;
const token = process.env.SECRET;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'MonkeModInfo-updater',
      'Accept': 'application/vnd.github+json'
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        getJson(res.headers.location).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function versionOf(tag) {
  const match = String(tag || '').match(/\d+(?:\.\d+)+/);
  return match ? match[0] : String(tag || '').replace(/[^\d.,]/g, '').trim();
}

async function main() {
  const results = await Promise.all(mods.map(async mod => {
    const repoPath = /^\d+$/.test(mod.gitPath)
      ? `repositories/${mod.gitPath}`
      : `repos/${mod.gitPath}`;
    const releasePath = mod.tag
      ? `releases/tags/${encodeURIComponent(mod.tag)}`
      : 'releases/latest';
    const url = `${API}${repoPath}/${releasePath}`;

    try {
      const release = await getJson(url);
      const asset = release.assets && release.assets[mod.releaseId];
      if (!asset) throw new Error(`asset #${mod.releaseId} not found`);

      return {
        name: mod.name,
        author: mod.author,
        version: versionOf(release.tag_name),
        ...(mod.dependencies ? { dependencies: mod.dependencies } : {}),
        ...(mod.dependents ? { dependents: mod.dependents } : {}),
        ...(mod.installPath ? { install_location: mod.installPath } : {}),
        git_path: mod.gitPath,
        group: mod.group,
        download_url: asset.browser_download_url
      };
    } catch (e) {
      console.error(`Skipping ${mod.name}: ${e.message}`);
      return null;
    }
  }));

  const list = results.filter(Boolean).sort((a, b) => {
    if (a.name === b.name) return 0;
    return a.name > b.name ? 1 : -1;
  });
  const output = JSON.stringify(list, null, 2) + '\n';
  const current = fs.existsSync('modinfo.json') ? fs.readFileSync('modinfo.json', 'utf8') : '';
  if (current.trim() !== output.trim()) {
    fs.writeFileSync('modinfo.json', output);
    console.log(`Wrote modinfo.json with ${list.length} mods (${mods.length - list.length} skipped)`);
  } else {
    console.log(`No changes (${list.length} mods, ${mods.length - list.length} skipped)`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
