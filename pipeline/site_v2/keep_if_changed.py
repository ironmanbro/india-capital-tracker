#!/usr/bin/env python3
"""After a refresh, keep the new files only if the DATA really changed. Every build stamps a "built" time, which alone would make a commit
on every run; when nothing but that stamp differs from the last commit, the working copy is restored and nothing is committed.
Usage: python3 keep_if_changed.py site/v2"""
import os, re, subprocess, sys

BUILT = re.compile(r'"built":"[^"]*"')
def head(path):
    r = subprocess.run(["git", "show", "HEAD:" + path], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "site/v2"
    real, same = [], []
    for f in sorted(os.listdir(d)):
        p = os.path.join(d, f).replace(os.sep, "/")
        old = head(p); new = open(p, encoding="utf-8").read()
        if old is None or BUILT.sub("", old) != BUILT.sub("", new): real.append(f)
        else: same.append(f)
    if real:
        print("data or pages changed:", ", ".join(real)); return
    subprocess.run(["git", "checkout", "--", d], check=True)      # restore the committed files: only the build stamps differed
    print("only build stamps differ in", len(same), "files; restored, nothing to commit")

if __name__ == "__main__": main()
