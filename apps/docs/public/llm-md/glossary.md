# Glossary

Source: https://kensaur.us/mushi-mushi/docs/glossary

---
title: Glossary
description: The words you will see on Mushi Mushi's site and console, each explained in one or two plain sentences, from diagnosis and fix prompt to MCP and pull request.
---

# Glossary

The words you will see on this site and in the Mushi Mushi console, in plain
English. New to all of it? Start with [What is Mushi Mushi?](/what-is-mushi-mushi)

- **AI builder or AI editor**: The tool that writes your app's code for you, such as Lovable, Bolt, Cursor or Claude Code.
- **API key**: A long password that lets your app or your tools talk to Mushi Mushi. Mushi Mushi keys start with `mushi_`. Keep the ones that can read reports private.
- **Bug mediator**: A name some pages here use for Mushi Mushi's job as the go-between. Bugs come in from your users and from other tools you may use. Mushi Mushi puts them in one list, explains each one once, and passes the fix to your AI builder.
- **CI (continuous integration)**: A service, such as GitHub Actions, that runs your app's tests every time the code changes. You don't need it to use Mushi Mushi.
- **Console**: Your Mushi Mushi account on the web. You sign in there to copy your script tag, read your bug reports and each diagnosis, copy fix prompts and change your settings. It is not the "console" inside a browser's developer tools.
- **Diagnosis**: Mushi Mushi's short written explanation of one bug: how serious it is, the likely cause, how sure it is, and a suggested fix. Your plan counts these.
- **Duplicate reports**: When several people report the same bug, Mushi Mushi groups them into one item, and they count as one diagnosis.
- **Fix prompt**: The diagnosis plus the evidence, written as instructions you paste into your AI builder so it can fix the bug.
- **MCP (Model Context Protocol)**: The standard way AI code editors such as Cursor and Claude Code connect to outside tools. It lets your editor read Mushi Mushi's reports itself. In Lovable or Bolt you don't need it.
- **Project ID**: The name tag that tells Mushi Mushi which of your apps a report came from. Your setup page fills it in for you.
- **Pull request (PR)**: A proposed change to your code that you can read before you accept it. An AI agent can open one with a fix, and nothing changes until you merge it, unless you turn on automatic merging.
- **Report button (widget)**: The small button Mushi Mushi adds to your app. People tap it, or shake their phone, to tell you something is wrong.
- **Script tag**: One line of code you add to your web page, usually by asking Lovable or Bolt to paste it. It shows the report button.
- **SDK**: A ready-made package of code for your kind of app (React, Expo and so on). It does the same job as the script tag, for apps that are set up with a terminal.
- **Self-host**: Running Mushi Mushi on your own server instead of using the hosted version. It is free, but you supply your own AI key and look after the server.
- **Sentry**: A popular service that records errors when code crashes. Mushi Mushi can read its errors if you use it, but you don't need it.
- **Severity**: How bad a bug is, from low to critical, so you know what to fix first.
