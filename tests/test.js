export async function loadDemo(controller) {
  const files = [
    'request.json',
    'request-anonymous.json',
    'request-unfill.json',
    'request-basic.json',
    'request-basic-unfill.json',
  ];
  const entries = await Promise.all(
    files.map(async (file, index) => {
      const response = await fetch(new URL(file, import.meta.url));
      if (!response.ok) throw new Error('A preview fixture could not be loaded.');
      const entry = await response.json();
      entry.startedDateTime = new Date(Date.now() - (files.length - index) * 1240).toISOString();
      for (const parameter of entry.request.queryString) {
        if (parameter.name === 'iu_parts')
          parameter.value = encodeURIComponent('1234567,dailyjournal,homepage,desktop,leaderboard,sidebar');
        if (parameter.name === 'iu') parameter.value = encodeURIComponent('/1234567/dailyjournal/article/sticky');
        if (parameter.name === 'prev_scp')
          parameter.value = encodeURIComponent('hb_bidder=appnexus&hb_pb=1.25|pos=sidebar&section=news');
        if (parameter.name === 'cust_params')
          parameter.value = encodeURIComponent('section=news&device=desktop&subscriber=false');
      }
      return entry;
    })
  );
  const video = structuredClone(entries[3]);
  video.startedDateTime = new Date().toISOString();
  video.request.queryString.push(
    { name: 'env', value: 'vp' },
    { name: 'output', value: 'vast' },
    { name: 'vpa', value: 'auto' }
  );
  video.request.queryString.find((parameter) => parameter.name === 'iu').value = encodeURIComponent(
    '/1234567/dailyjournal/video/preroll'
  );
  controller.navigate('https://dailyjournal.example');
  await Promise.all([...entries, video].map((entry) => controller.accept(entry)));
}
