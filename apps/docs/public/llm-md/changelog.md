# Changelog

Source: https://kensaur.us/mushi-mushi/docs/changelog

---
title: Changelog
description: What shipped in Mushi Mushi — new SDK releases, console features, MCP tools, and fixes, in plain English with dates.
---

# Changelog

The complete release history, generated automatically from
[Changesets](https://github.com/changesets/changesets) every time we
publish to npm. Want only the highlights? Subscribe to
[GitHub Releases](https://github.com/kensaurus/mushi-mushi/releases) for
a curated email feed.

  {changelog.map((release) => (
    
      
        
          v{release.majorMinor}
        
        {release.pending && (
          
            upcoming
          
        )}
        {release.versions?.length ? (
          
            includes {release.versions.join(', ')}
          
        ) : null}
      

      {release.headline && (
        
          {release.headline}
        
      )}

      {release.highlights?.length > 0 && (
        
          {release.highlights.map((h, i) => (
            
              
                {h.title}
              
              {h.description ?  — {h.description} : null}
            
          ))}
        
      )}
    
  ))}
