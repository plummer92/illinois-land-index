/* Consume parcel-map coordinates before site analytics sees the page URL. */
(()=>{
  const url=new URL(location.href);
  if(!url.searchParams.has('lon')||!url.searchParams.has('lat'))return;
  const lon=Number(url.searchParams.get('lon')),lat=Number(url.searchParams.get('lat'));
  if(Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=-90.61&&lon<=-89.20&&lat>=38.99&&lat<=39.99)window.ILIParcelCoordinate=[lon,lat];
  url.searchParams.delete('lon');url.searchParams.delete('lat');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
})();
