#!/usr/bin/env python3
"""build_oap_app.py [--language xx] <app> - builds an app that has mgu-app.json (not app.json) into
dist/<id>@<ver>.mgu, the bundle deploy/mgu-app-install.sh installs, like build.py does for the kit's
own apps. Used for apps/tjm_waze_cluster (TJM Waze Cluster, from robertn_waze_cluster).

  1. links the app against the car's own oap-sdk (kit/tools/link_oap_app.js, Node.js), with the
     x_call package the installer's "Extract SDK" keeps in oap-sdk/donor/
  2. source/      = that OAP package
     rhmiData/    = its rhmiData in the installed format (uiDescription/, strings/, resources/)
     meta.json, oapgen/   as build.py writes them

These apps carry their own translations, so --language only names the file as make_kit.py expects.
"""
import argparse, glob, json, os, shutil, subprocess, sys, tarfile, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import ROOT, KIT, DIST, SDK, NATIVE, u, gz_header_free   # noqa: E402
from localize import languages, normalize_language, package_version  # noqa: E402

APPS = os.path.join(ROOT, 'apps')


def donors():
    d = os.path.join(SDK, 'donor')
    found = [p for p in (os.path.join(d, 'x_call.tgz'), os.path.join(d, 'javascript', 'app.js')) if os.path.isfile(p)]
    if not found:
        sys.exit('ERROR: the car\'s x_call package is missing (oap-sdk/donor/). TJM Waze Cluster is built from it:\n'
                 '  connect a car, Detect, then press "Extract SDK" once more (it keeps the package now).')
    return found


def build(name, language='en'):
    app = os.path.join(APPS, name)
    m = json.load(open(os.path.join(app, 'mgu-app.json'), encoding='utf-8'))
    app_id, ver = m['id'], m['version']
    node = shutil.which('node')
    if not node:
        sys.exit('ERROR: Node.js not found (nodejs.org, LTS)')
    os.makedirs(DIST, exist_ok=True)
    stage = tempfile.mkdtemp(prefix=app_id + '-')
    try:
        oap = os.path.join(stage, app_id + '.tgz')
        r = subprocess.run([node, os.path.join(KIT, 'tools', 'link_oap_app.js'), app, oap] + donors())
        if r.returncode:
            sys.exit('ERROR: linking %s failed' % app_id)

        # source/: the OAP package (flat: package.json at the top)
        src = os.path.join(stage, 'source')
        os.makedirs(src)
        with tarfile.open(oap, 'r:gz') as tf:
            for mem in tf.getmembers():
                n = mem.name
                if not mem.isfile() or n.startswith('/') or '..' in n.split('/'):
                    sys.exit('ERROR: unexpected entry in the linked package: %s' % n)
                out = os.path.join(src, *n.split('/'))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with tf.extractfile(mem) as f, open(out, 'wb') as o:
                    shutil.copyfileobj(f, o)
        for need in ('package.json', 'manifest.json', os.path.join('javascript', 'app.js'), os.path.join('rhmiData', 'application.json')):
            if not os.path.isfile(os.path.join(src, need)):
                sys.exit('ERROR: the linked package has no %s' % need)

        # rhmiData/: installed format, as build.py writes it for the kit's own apps
        pr = os.path.join(src, 'rhmiData')
        pj = json.load(open(os.path.join(pr, 'application.json'), encoding='utf-8'))
        ui = pj['application']['uiDescriptions'][0]
        vg = pj['application']['variantGroups'][0]
        ij = json.loads(json.dumps(pj))
        a = ij['application']
        a.pop('uiDescriptions', None); a.pop('variantGroups', None)
        a.update({
            'entryPointsStringBundleUuid': u(app_id, 'ep-strings'), 'entryPointsResourceBundleUuid': u(app_id, 'ep-resources'),
            'externalDialogStringBundleUuid': u(app_id, 'ed-strings'),
            'bookmarkUuidPool': [u(app_id, 'bookmarks'), 1, 2, 3, 4, 5, 6, 7],
        })
        ir = os.path.join(stage, 'rhmiData')
        for sub in ('uiDescription', 'strings', 'resources'):
            os.makedirs(os.path.join(ir, sub))
        json.dump(ij, open(os.path.join(ir, 'application.json'), 'w', encoding='utf-8', newline='\n'), separators=(',', ':'))
        shutil.copy(os.path.join(pr, *ui['applicationFilePath'].split('/')[1:]), os.path.join(ir, 'uiDescription', 'application.xml'))
        shutil.copy(os.path.join(pr, *ui['uiDescriptionFilePath'].split('/')[1:]), os.path.join(ir, 'uiDescription', 'uiDescription.json'))
        texts = os.path.join(pr, *vg['stringsPath'].split('/')[1:])
        for t in sorted(glob.glob(os.path.join(texts, '*.json'))):
            shutil.copy(t, os.path.join(ir, 'strings', os.path.basename(t)))
        images = os.path.join(pr, *vg['resourcesPath'].split('/')[1:])
        for i in sorted(os.listdir(images)):
            shutil.copy(os.path.join(images, i), os.path.join(ir, 'resources', i))

        # installer helpers + metadata
        shutil.copytree(os.path.join(KIT, 'tools', 'oapgen'), os.path.join(stage, 'oapgen'))
        title = json.load(open(os.path.join(texts, 'en_GB.json'), encoding='utf-8')).get('SID_WOC_TITLE', app_id) \
            if os.path.isfile(os.path.join(texts, 'en_GB.json')) else app_id
        json.dump({'id': app_id, 'version': ver, 'title': title, 'native': NATIVE, 'kit': 1},
                  open(os.path.join(stage, 'meta.json'), 'w', encoding='utf-8', newline='\n'), indent=1)

        bundle = os.path.join(DIST, '%s@%s.mgu' % (app_id, package_version(ver, language)))
        with gz_header_free(bundle) as gz, tarfile.open(fileobj=gz, mode='w') as tf:
            for n in ('meta.json', 'source', 'rhmiData', 'oapgen'):
                tf.add(os.path.join(stage, n), arcname=n)
        print('%s %s: %s (%d KiB)' % (app_id, ver, os.path.relpath(bundle, ROOT), os.path.getsize(bundle) // 1024))
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', type=normalize_language, choices=languages(), default='en')
    parser.add_argument('apps', nargs='+')
    args = parser.parse_args()
    for a in args.apps:
        build(a, args.language)


if __name__ == '__main__':
    main()
