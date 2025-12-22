---
active: true
iteration: 1
max_iterations: 10000
completion_promise: "STOP"
started_at: "2025-12-22T23:07:19Z"
---

run /bmad:bmm:workflows:create-story then /bmad:bmm:workflows:dev-story /bmad:bmm:workflows:code-review resolve all issues
run /bmad:bmm:workflows:code-review again and resolve any remaining issues
git commit, any questions you can't answer yourself to result in high quality functioning code without compromising on scope for example if you need me to authenticate to something to deploy or to install something output <promise>STOP</promise>, otherwise keep going until you complete all stories and epics and then output <promise>STOP</promise>, when you get to the end of a sprint run  /bmad:bmm:workflows:retrospective over the sprint, make any remediations sugggested then continue
