# LinkedIn post

Publish this after making the repository public.

---

Meet Jev, TypeSafe AI's model for making structured decisions that software can act on.

Give it a customer message and a set of questions, and it returns choices and probabilities—for example, what the customer needs and whether a person should review the request.

I built Route Lab to show what that looks like in a real business workflow.

For each e-commerce support message, it evaluates:
• Intent
• Urgency
• Missing information
• Whether human review is needed

Those decisions become a proposed route to Orders, Shipping, Returns, Payments or a review queue.

Why Jev? TypeSafe designed it for typed decisions and probabilities, with parallel outputs rather than token-by-token text generation. That makes it an interesting candidate for workflows where latency matters and the next step is a software action.

Gemini can handle these tasks too. The useful question is where a specialized decision model gives you a better trade-off between speed, cost and accuracy.

So Route Lab sends the same message and definitions to Jev and Gemini 2.5 Flash-Lite, with Gemini thinking both on and off. All four questions travel in one request per setting.

The demo makes the comparison visible:
→ Live decision diagrams showing the proposed department and owner
→ #1 / #2 / #3 reply arrivals and placement totals
→ Typical response time, plus the time within which 95% of successful requests finish
→ Request costs and intent accuracy

I sampled 540 messages across 27 intents from Bitext's Hugging Face dataset. Intent labels are already available, so you can start without manually answering hundreds of messages. Optional human review lets you add reference answers for the 12 demo cases.

The dataset is hybrid synthetic. This is an experiment you can reproduce—not a claim that one model wins every workload. Arrival order includes network and database time; the three-second presentation pause does not count toward API latency.

Beyond customer support, the same pattern could help triage maintenance requests, route procurement issues or decide which incoming work needs human attention.

The code is available to clone or fork. Bring your own API keys, try your own messages, and inspect the results:

https://github.com/egepakten/jev-decision-demo

I'd be interested to see where this approach is useful in your workflow.

#AI #Jev #TypeSafeAI #OpenSource #Ecommerce #Automation

---

Technical sources:
- TypeSafe's explanation of Jev: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Dataset: https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset
