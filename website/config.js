// Where the download buttons point. The game builds are too big for Netlify (it wants files under 10 MB),
// so they live on GitHub Releases. Upload SendIt-Windows.zip and SendIt-Mac.zip to a release in the
// public repo below and these links always fetch the newest one.
window.SENDIT = {
  version: '2.2',
  downloads: {
    windows: 'https://github.com/Jamie782/sendit/releases/latest/download/SendIt-Windows.zip',
    macArm: 'https://github.com/Jamie782/sendit/releases/latest/download/SendIt-Mac-AppleSilicon.zip',
    macIntel: 'https://github.com/Jamie782/sendit/releases/latest/download/SendIt-Mac-Intel.zip',
  },
  discord: '', // your Discord server invite, e.g. https://discord.gg/xxxx (leave empty to hide the button)
};
