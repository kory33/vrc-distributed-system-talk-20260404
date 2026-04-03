# verifier-app/AGENTS.md

This npm package contains the React app with which users can
- visualize Kripke structures
- visualize the internal states of model checking algorithms

## Coding Guidelines / Philosophy

The purpose of this workspace is to support the development of a mathematical theory
by means of computational experiments.

To achieve high reliability, the **core philosophy** we will follow is this:
- We *may not* actually formally prove their correctness, but you MUST write
  implementations *as if* you *will have to* white-box-verify them later.

This means every piece of code as well as documentation must be *locally reasonable*,
in the sense that a reader should be able to infer the correctness of the program
by looking only at the local context, without needing to re-derive non-obvious equivalences or
nontrivially "guess" the meaning of a term.

To aid such reasonings, implementations should be:

- As generic as possible, unless the computation is truly intractable without specialization and limitation.
  Don't specialize by thinking "we will only deal with smaller cases", since reasoning tends to be harder with such specializations.
- As reliable as possible, and
- As simple and concise as possible.

Being formal does not mean throwing away *intuitive meaning*s. In particular, we MUST aim to
name functions and variables in a way that "intuitive meanings", or the meaning that
an experienced human would naturally and immediately associate with the concept, is reflected in the name.
This is often the hardest part, but as a coding agent, you are expected to *emulate* a human reader's thought process.
I strongly recommend you explicitly spelling out phrases such as `If I were a human reader, I would be thinking "..."`
at various points in the design and implementation process.

**Do use** mathematical terminology to achieve this goal, since mathematics is culturally
a huge *standard library* of well-defined concepts, and our intuitions tend to be tightly coupled with such words.
On the other hand, **avoid** names based on the call-site context, type implementation details,
or the implementation details of the function itself. Name based on **what** the function or type *is*
rather than what it *does* or *how* it does it.

### Designing Interfaces as if You Will Formally Verify Them Later

To reiterate, we follow the principle:
- We *may not* actually formally prove their correctness, but you MUST write
  implementations *as if* you *will have to* white-box-verify them later.

In type definitions and implementations that are not tied to particular computational experiments,
you should aim for "uniform" (i.e. non-ad-hoc) treatment of concepts involved, and avoid creating
corner cases or undocumented implicit contracts. *This is to aid reasoning about correctness*
(the *primary goal is the ease of reasoning*, and "readability" should then be a natural byproduct).
Accordingly, even inside function definitions, you should strive for simplicity.

You should put effort into simplifying datatypes and type definitions, and when simple ADTs + std collections are
insufficient to represent the idea, you MUST specify invariants so that downstream code can reason
with minimal effort. Datatypes are not auxiliary constructs that merely exist for functions to operate on,
but they form the core part of the value these modules should deliver.

Although the code is currently in languages that don't support strong logics like HOL or dependent types,
you should design interfaces *as if* such logics are available for (almost) completely specifying the input/output types of functions.
In particular, the assumptions and guarantees of a function should be statable using only its arguments, return value,
and stated invariants of the types in its signature.

### Operational Rules for Local Verifiability

- Documentation for public types and pure functions must be **denotational**: state the
  mathematical object returned or represented, not the computation. Lead with
  `Returns ...` or `Represents ...`, and bind as many symbols as possible to parameters
  (for "usually implicit" parameters, like the length of a vector, state them
  in the doc and define them as quantities derived from the parameters).
- State invariants on representation fields.
- You are encouraged to write comments that justify non-obvious steps in the implementation.
- **Checked constructors** must establish their stated invariants with `assert!`.
  Don't introduce unchecked paths unless necessary, and if you do, name them `*_unchecked`
  and document the trusted preconditions.
- After changing a definition, invariant, notation, or term of art, sweep nearby docs,
  comments, tests, and complexity claims for stale references. This includes: undefined
  variables introduced by the old wording, theorem statements that became vacuous, and
  internal comments that reference the old name or concept.

### Testing

I (the project owner, @kory33) would recommend writing property-based tests (PBTs) to
realize the philosophy as discussed above. Roughly speaking, you should design PBTs
with the following design questions in mind:

1. If complete specification through dependent types (or first-order logic) is possible,
   how would you specify that function (or datatype)? What specification lemmas would you prove?
2. In particular, had that function been defined as opaque (i.e. the user is not able to inspect its definition body at all),
   what specification lemmas would you *need* in order to reason about the function in downstream modules?
3. Is that specification lemma in any way *experimentable*, i.e. can you write a PBT for that specification?

Ideally, the body of a property-based test should be (minimal definitions plus) a single line of
assertion, which itself should read as a theorem regarding values of the type being tested.
This theorem is essentially conditioned on any `.filter`, so such filtrations should themselves
be minimal (theorems with weaker assumptions are more useful).

The test design process should often feed back into interface designs. Notably, if the theorem
you want to test cannot be stated from the function's signature alone, the interface is probably
hiding semantic context and needs redesigning.

#### Parameter Generation

As a general rule of thumb in PBT design, you should only mildly control hyperparameters of the
generated test cases (e.g. dimensions, bounds, etc.), and let the test generator explore the
parameter space as much as possible.

@./WORKFLOW.md
