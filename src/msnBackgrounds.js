// Existing MSN Messenger 7.5.0322 resources. Labels for the static photographs
// describe their contents; the dynamic package names come from content.xml.
const resourcePath = "./msn-assets/msn75/resources/msnmsgr/JPG";
const packagePath = "./msn-assets/msn75/packages/dynamic-backgrounds";

export const MSN_BACKGROUNDS = [
  { id: "msn-racing", label: "Course automobile", resourceId: 340 },
  { id: "msn-fish", label: "Poissons", resourceId: 341 },
  { id: "msn-hearts", label: "Cœurs", resourceId: 342 },
  { id: "msn-lavender", label: "Lavande", resourceId: 343 },
  { id: "msn-planets", label: "Planètes", resourceId: 344 }
].map(({ resourceId, ...background }) => Object.freeze({
  ...background,
  kind: "static",
  runtimeSupported: true,
  src: `${resourcePath}/msnmsgr_JPG_${resourceId}_9.jpg`,
  sourceResource: `msnmsgr_JPG_${resourceId}_9.jpg`
}));

export const MSN_DYNAMIC_BACKGROUNDS = [
  { id: "msn-koi-pond", label: "Koi Pond", resourceId: 1600, animationFile: "KoiPond.swf", backgroundFile: "background.jpg" },
  { id: "msn-clocks", label: "Clocks", resourceId: 1601, animationFile: "Clocks.swf", backgroundFile: "background.jpg" },
  { id: "msn-mad-scientist", label: "Mad Scientist", resourceId: 1602, animationFile: "mad_scientist.swf", backgroundFile: "background.jpg" },
  { id: "msn-pixies", label: "Pixies", resourceId: 1603, animationFile: "Pixies.swf", backgroundFile: "Background.jpg" }
].map(({ resourceId, animationFile, backgroundFile, ...background }) => {
  const sourcePackage = `msgslang_DYNAMICBACKGROUND_${resourceId}_9`;
  const base = `${packagePath}/${sourcePackage}`;
  return Object.freeze({
    ...background,
    kind: "dynamic",
    // Native Flash/Messenger callbacks are not available in this renderer.
    // The supplied downlevel image is the original static compatibility view.
    runtimeSupported: false,
    src: `${base}/extracted/downlevel.jpg`,
    poster: `${base}/extracted/downlevel.jpg`,
    backgroundSrc: `${base}/extracted/${backgroundFile}`,
    animationSrc: `${base}/extracted/${animationFile}`,
    sourcePackage,
    sourceArchive: `${base}/inner.mct`,
    reason: "Aperçu statique d’origine ; animation Flash MSN non prise en charge."
  });
});

export const MSN_ALL_BACKGROUNDS = Object.freeze([
  ...MSN_BACKGROUNDS,
  ...MSN_DYNAMIC_BACKGROUNDS
]);

export function getMsnBackground(id) {
  return MSN_ALL_BACKGROUNDS.find((background) => background.id === id) || null;
}

export default MSN_ALL_BACKGROUNDS;
