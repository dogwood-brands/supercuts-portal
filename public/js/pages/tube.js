// SC Tube: short training videos by channel. Pick a channel, choose a video.

import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { ui } from '../core/ui.js';
import { num } from '../core/format.js';
import { region, cover } from './admin/kit.js';

const ACADEMY = 'https://academy.dogwoodbrands.com';

function duration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/** Decide how a video can be played. Only our own files and two trusted hosts are ever embedded. */
function playable(url) {
  if (!url) return { kind: 'soon' };
  let u;
  try {
    u = new URL(url, location.origin);
  } catch {
    return { kind: 'soon' };
  }
  if (u.origin === location.origin || /\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { kind: 'file', src: u.href };
  if (u.hostname === 'www.youtube-nocookie.com' && u.pathname.startsWith('/embed/')) return { kind: 'frame', src: u.href };
  if (u.origin === ACADEMY) return u.pathname.length > 1 ? { kind: 'frame', src: u.href } : { kind: 'academy', src: u.href };
  return { kind: 'soon' };
}

function openVideo(v, onViewed) {
  const p = playable(v.url);
  let stage;
  if (p.kind === 'file') {
    stage = h('video', { class: 'player', src: p.src, controls: true, playsInline: true, poster: v.poster_url || null, preload: 'metadata' });
    stage.setAttribute('playsinline', '');
  } else if (p.kind === 'frame') {
    stage = h('iframe', { class: 'player', src: p.src, title: v.title, allow: 'fullscreen; picture-in-picture', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
  } else {
    stage = h('div', { class: 'player player-still' },
      cover(v.poster_url, { iconName: 'play' }),
      h('div', { class: 'player-still-copy' },
        p.kind === 'academy'
          ? [h('h3', null, 'This lesson lives in Supercuts Academy'), h('p', { class: 't-sm' }, 'It opens in a new tab, with the quiz that goes with it.'),
            h('a', { class: 'btn btn-brand', href: p.src, target: '_blank', rel: 'noopener' }, ui.icon('external', 18), 'Open in Academy')]
          : [h('h3', null, 'Coming soon'), h('p', { class: 't-sm' }, 'This video is being filmed. It will play right here once it is ready.')]));
  }
  const m = ui.modal({
    title: v.title,
    size: 'lg',
    body: h('div', { class: 'stack' },
      stage,
      h('div', { class: 'row gap-3 row-wrap t-sm t-muted' },
        v.channel ? ui.badge(v.channel) : null,
        v.duration_s ? h('span', { class: 'row gap-1' }, ui.icon('clock', 14), duration(v.duration_s)) : null,
        h('span', { class: 'row gap-1' }, ui.icon('eye', 14), `${num(v.views || 0)} views`)),
      v.description ? h('p', null, v.description) : null),
  });
  m.onClose = () => { if (stage.pause) stage.pause(); };
  if (p.kind !== 'soon') {
    api.post(`/videos/${v.id}/view`).then((r) => { if (r && r.views !== undefined) { v.views = r.views; onViewed(); } }).catch(() => {});
  }
}

function videoCard(v, i, repaint) {
  const soon = playable(v.url).kind === 'soon';
  const card = h('button', { class: 'card card-link content-card video-card', type: 'button', onClick: () => openVideo(v, repaint) },
    h('div', { class: 'content-card-media' },
      cover(v.poster_url, { iconName: 'play' }),
      h('span', { class: 'video-play', 'aria-hidden': 'true' }, ui.icon('play', 44)),
      v.duration_s ? h('span', { class: 'video-time' }, duration(v.duration_s)) : null,
      soon ? h('span', { class: 'content-card-flag' }, ui.badge('Coming soon', 'dark')) : null),
    h('div', { class: 'card-pad col gap-2' },
      h('div', { class: 't-eyebrow' }, v.channel || 'General'),
      h('h3', null, v.title),
      v.description ? h('p', { class: 't-sm t-muted t-clamp-2' }, v.description) : null,
      h('div', { class: 't-xs t-faint' }, `${num(v.views || 0)} views`)));
  return ui.reveal(card, Math.min(i, 6) * 40);
}

// Two channels (v1.1): job essentials (point of sale, cash handling, pay plans; mostly required) and
// advanced technique (short refreshers and skill building; mostly optional). Assigned courses live in Academy.
const CHANNEL_BLURB = {
  'Job essentials': 'Point of sale, cash handling, pay plans and the everyday parts of the job.',
  'Advanced technique': 'Short refreshers and new skills, from the chair.',
};

export default {
  title: 'SC Tube',
  css: true,
  render(ctx) {
    const host = h('div');
    const academy = ctx.settings?.academy_url || ACADEMY;
    let items = [];
    const view = () => {
      if (!items.length) return ui.empty({ icon: 'play', title: 'No videos yet', body: 'Training videos will appear here as they are published.' });
      const repaint = () => mount(host, view());
      const popular = [...items].filter((v) => playable(v.url).kind !== 'soon').sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 4);
      const channels = [...new Set(['Job essentials', 'Advanced technique', ...items.map((v) => v.channel || 'General')])];
      return h('div', { class: 'stack-lg' },
        popular.length ? h('section', { class: 'stack' },
          h('h2', null, 'Popular right now'),
          h('div', { class: 'grid content-grid' }, popular.map((v, i) => videoCard(v, i, repaint)))) : null,
        channels.map((c) => {
          const list = items.filter((v) => (v.channel || 'General') === c);
          return h('section', { class: 'stack' },
            h('div', null, h('h2', null, c), CHANNEL_BLURB[c] ? h('p', { class: 't-sm t-muted' }, CHANNEL_BLURB[c]) : null),
            list.length
              ? h('div', { class: 'grid content-grid' }, list.map((v, i) => videoCard(v, i, repaint)))
              : h('div', { class: 'card' }, ui.empty({ icon: 'play', title: 'First videos coming soon', body: 'This channel is being filmed now.' })));
        }));
    };
    region(host, async () => {
      const res = await api.get('/videos');
      items = res.items || [];
      return view();
    });
    return h('div', null,
      ui.pageHeader({
        eyebrow: 'Excellence', title: 'SC Tube',
        sub: 'Short videos from our own salons. Watch one, try it on your next guest. Assigned courses are in Supercuts Academy.',
      }),
      h('a', { class: 'card card-link tube-academy', href: academy, target: '_blank', rel: 'noopener' },
        h('span', { class: 'job-tile-icon' }, ui.icon('book', 22)),
        h('div', { class: 'grow' },
          h('h3', null, 'Supercuts Academy'),
          h('p', { class: 't-sm t-muted' }, 'Your assigned courses, quizzes and certificates. Opens in a new tab.')),
        ui.icon('external', 18)),
      host);
  },
};
