# Wrapper: patches hardcoded paths in scrape_v2 and runs it
import sys, types, builtins

# Patch open() so /tmp/tek_final_urls.txt -> C:/tmp/tek_final_urls.txt
# and output goes to the right place
_real_open = builtins.open
def patched_open(path, *args, **kwargs):
    if isinstance(path, str):
        path = path.replace('/tmp/', 'C:/tmp/')
        path = path.replace('/home/exedev/tek_docs_scraped.json',
                            'C:/Users/u650455/Desktop/Tek_Automator/TekAutomateMCPV2/scripts/tek-scraper/tek_docs_scraped.json')
    return _real_open(path, *args, **kwargs)
builtins.open = patched_open

# Run the scraper
exec(open('C:/Users/u650455/Desktop/Tek_Automator/TekAutomateMCPV2/scripts/tek-scraper/scrape_v2.py').read())
